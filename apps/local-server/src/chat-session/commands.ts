import type { ChatActionPayload } from "@aop/common";
import { aopPaths, generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { interruptSessionRun } from "./runtime-engine.ts";
import { discoverRuntimeSkills } from "./skill-discovery.ts";
import { cancelQueuedSteers } from "./steer-queue.ts";

export interface CommandResult {
  text: string;
  action?: ChatActionPayload;
  /** When true, the caller should run the message through the provider instead. */
  forwardToRuntime?: boolean;
  runtimePromptPrefix?: string;
  /** Applied to the session that received the command (for example settlement after /clear). */
  sessionPatch?: Partial<{
    settled_override: "settled" | "active" | null;
    settled_at: string | null;
    pinned: boolean;
  }>;
}

const USAGE = {
  workflow: "Usage: /workflow run <name> — opens the named workflow in Workflow Studio.",
  skill: "Usage: /skill <name> — run a discoverable runtime skill in this session.",
  clear: "Usage: /clear — settle this session and open a fresh one (new CLI runtime context).",
} as const;

const LOCAL_SLASH_COMMANDS = new Set(["/alias", "/workflow", "/clear"]);

/**
 * Intercepts slash commands that should not rely solely on the runtime agent.
 *
 * Returns null when the message should run through the provider as-is.
 */
export const executeChatCommand = async (
  ctx: LocalServerContext,
  session: ChatSession,
  text: string,
): Promise<CommandResult | null> => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  return handleSlashCommand(ctx, session, trimmed);
};

export const slashCommandMayReachRuntime = (text: unknown): boolean => {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return false;
  const commandName = trimmed.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (commandName === "/skill") return /^\/skill\s+\S/i.test(trimmed);
  return !LOCAL_SLASH_COMMANDS.has(commandName);
};

const handleSlashCommand = async (
  ctx: LocalServerContext,
  session: ChatSession,
  trimmed: string,
): Promise<CommandResult> => {
  const commandName = trimmed.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  switch (commandName) {
    case "/alias":
      return {
        text: "Runtime executables are configured in Settings → Runtime configuration (command on each runtime). /alias is no longer supported.",
      };
    case "/workflow":
      return handleWorkflow(ctx, session, trimmed);
    case "/skill":
      return handleSkill(ctx, session, trimmed);
    case "/clear":
      return handleClear(ctx, session);
    default:
      return {
        text: `Forwarding ${trimmed.split(/\s+/, 1)[0]} to the runtime.`,
        forwardToRuntime: true,
      };
  }
};

/**
 * Settle the current session and create a neutral sibling with the same scope/runtime
 * preferences but a clean CLI runtime_session_id.
 */
const handleClear = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<CommandResult> => {
  interruptSessionRun(session.id, "abort");
  await cancelQueuedSteers(ctx, session.id, session.runtime);

  const now = new Date().toISOString();
  const newSessionId = generateTypeId("isess");
  await ctx.chatSessionRepository.create({
    id: newSessionId,
    repo_id: session.repo_id,
    title: session.repo_id ? "New session" : "New chat",
    named: false,
    runtime: session.runtime,
    runtime_configuration_id: session.runtime_configuration_id,
    model: session.model,
    reasoning_effort: session.reasoning_effort,
    runtime_alias: session.runtime_alias,
    // Fresh CLI/runtime conversation — do not resume the settled thread.
    runtime_session_id: null,
    workspace_path: session.workspace_path,
    fast_mode: session.fast_mode,
    default_workflow_id: session.default_workflow_id,
    pinned: false,
    settled_override: null,
    settled_at: null,
    created_at: now,
    updated_at: now,
  });

  return {
    text: "Settled this session and opened a fresh one. The new session starts a clean CLI runtime context.",
    action: {
      type: "session",
      id: newSessionId,
      label: "New session",
      sub: session.repo_id ? "Same repository" : "General",
      meta: "cleared",
      status: "live",
    },
    sessionPatch: {
      settled_override: "settled",
      settled_at: now,
      pinned: false,
    },
  };
};

const handleWorkflow = async (
  ctx: LocalServerContext,
  session: ChatSession,
  text: string,
): Promise<CommandResult> => {
  const name = text.replace(/^\/workflow\s*(run\s+)?/i, "").trim();
  if (!name) return { text: USAGE.workflow };

  const workflows = await ctx.workflowRepository.listActive();
  const match = workflows.find(
    (w) => w.name.toLowerCase() === name.toLowerCase() || w.id.toLowerCase() === name.toLowerCase(),
  );
  if (!match) {
    const available = workflows.map((w) => w.name).join(", ") || "(none)";
    return {
      text: `Unknown workflow “${name}”. Available: ${available}.`,
    };
  }

  const repoName = await resolveRepoName(ctx, session.repo_id);
  return {
    text: `Opened ${match.name} for ${repoName} — open Workflow Studio to inspect or edit steps.`,
    action: {
      type: "workflows",
      id: match.id,
      label: "Workflow targeted",
      sub: match.name,
      meta: repoName,
    },
  };
};

const handleSkill = async (
  ctx: LocalServerContext,
  session: ChatSession,
  text: string,
): Promise<CommandResult> => {
  const name = text.replace(/^\/skill\s*/i, "").trim();
  const skills = await skillsForSession(ctx, session);
  const ecmd = runtimeDisplayCmd(session.runtime, session.runtime_alias);

  const matched = skills.find((skill) => skill.toLowerCase() === name.toLowerCase());
  if (!name || !matched) {
    const prefix = name ? `“${name}” isn’t exposed by ${ecmd}. ` : "";
    if (skills.length === 0) {
      return {
        text: `${prefix}No discoverable skills for ${ecmd}. ${USAGE.skill}`,
      };
    }
    return {
      text: `${prefix}Skills on ${ecmd}: ${skills.join(" · ")}. Run one with /skill <name>.`,
    };
  }

  return {
    text: `Ran ${matched} via ${ecmd} — output is pinned to this session.`,
    forwardToRuntime: true,
  };
};

const skillsForSession = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<string[]> => {
  const repo = session.repo_id ? await ctx.repoRepository.getById(session.repo_id) : null;
  return discoverRuntimeSkills(session.runtime, repo?.path ?? aopPaths.generalChatWorkspace());
};

const resolveRepoName = async (ctx: LocalServerContext, repoId: string | null): Promise<string> => {
  if (!repoId) return "AOP";
  const repo = await ctx.repoRepository.getById(repoId);
  if (!repo) return repoId;
  return repo.name ?? repo.path.split("/").pop() ?? repoId;
};

const runtimeDisplayCmd = (runtime: string, alias: string | null): string => {
  if (alias?.trim()) return alias.trim();
  const labels: Record<string, string> = {
    "claude-code": "claude",
    "codex-cli": "codex",
    "grok-build": "grok",
    opencode: "opencode",
    pi: "pi",
  };
  return labels[runtime] ?? runtime;
};
