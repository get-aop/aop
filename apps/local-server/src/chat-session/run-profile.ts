import type { RunAccessMode, RunIsolation } from "@aop/llm-provider";
import type { ChatSession } from "../db/schema.ts";
import { claudeMcpToolName, sessionRole, toolNamesFor } from "../mcp/availability.ts";

/** How a session's runs differ from a plain chat's, by what the session is. */
export interface RunProfile {
  isolation: RunIsolation;
  /**
   * The command and file permission policy of the run: the host's permission bypass, else what
   * the session is (a pinned mode), else the row (a plain chat's own setting, or the access a
   * project chose for its threads).
   */
  accessMode: RunAccessMode;
  /** Tools pre-approved because a run without a terminal cannot ask. */
  allowedTools?: string[];
  disallowedTools?: string[];
  /** An empty list leaves the run with MCP tools only. */
  builtInTools?: string[];
  env: Record<string, string>;
}

/** What the host decided for every run it launches now (see agent-cli/permission-bypass.ts). */
export interface HostRunAccess {
  /** The owner's "skip permission checks" setting is on and this host can honour it. */
  skipPermissions: boolean;
}

const NO_HOST_BYPASS: HostRunAccess = { skipPermissions: false };

type BaseProfile = Omit<RunProfile, "accessMode"> & { accessMode?: RunAccessMode };

// Claude Code built-ins that read or change the host, reach the network, or start other agents
// (2.1.287 names; Glob and Grep join the tool list when Bash is withheld).
const HOST_BUILT_IN_TOOLS = [
  "Bash",
  "Read",
  "Edit",
  "Write",
  "NotebookEdit",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
];

// The coordinator processes what people and threads write, so it fails closed. It is hermetic
// (no user or project settings, hooks, MCP servers, CLAUDE.md or auto memory) and asks for no
// built-in tools (`--tools ""`), so all real work goes through a thread. Two more layers back
// that up. Without the host's permission bypass it runs `approval-required`, pinned here rather
// than trusted from the row, so no stored value can reopen it: no permission-skipping flag, and a
// headless run denies whatever `allowedTools` does not pre-approve. With the bypass, allow-lists
// no longer hold, so the built-ins that touch the host are also denied by name: deny rules hold
// in bypass mode, and `--tools ""` holds whatever the mode (both checked on Claude Code 2.1.287;
// see run-profile.test.ts and docs/RUNTIMES.md).
const COORDINATOR_PROFILE: BaseProfile = {
  isolation: "hermetic",
  accessMode: "approval-required",
  builtInTools: [],
  disallowedTools: HOST_BUILT_IN_TOOLS,
  env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
};

// A thread works like the person's own Claude Code (their settings, hooks, MCP servers) plus
// the AOP tools. Claude's own question tool cannot be answered without a terminal, so it is
// withheld in favour of `aop_ask_user`, whose answer arrives as the next turn.
//
// The built-ins that schedule or wake a session are withheld too. A thread's turn ends when it
// reports or asks, and AOP decides when the next one starts; a thread that armed its own wakeup,
// cron, monitor or remote trigger would either be cut off with the process or start turns AOP
// does not know about (Claude Code 2.1.285 tool names).
export const SCHEDULING_BUILT_IN_TOOLS = [
  "ScheduleWakeup",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Monitor",
  "RemoteTrigger",
];

const THREAD_PROFILE: BaseProfile = {
  isolation: "open",
  disallowedTools: ["AskUserQuestion", ...SCHEDULING_BUILT_IN_TOOLS],
  env: {},
};

/**
 * The access of a read-only thread (a new project's survey). No project gives its threads this
 * access, so a thread that has it was started read-only; see thread/thread-session.ts.
 */
export const READ_ONLY_ACCESS = "approval-required";

// A read-only thread asks for no permission-skipping flag, so a headless run denies what is not
// pre-approved: file edits and commands. Reading files needs no approval; these commands read the
// history and the open work a survey reports on, and change nothing.
export const READ_ONLY_COMMANDS = [
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git branch:*)",
  "Bash(git status:*)",
  "Bash(gh pr list:*)",
  "Bash(gh pr view:*)",
  "Bash(gh issue list:*)",
  "Bash(gh run list:*)",
];

export const runProfileFor = (
  session: Pick<ChatSession, "kind" | "runtime_access_mode">,
  host: HostRunAccess = NO_HOST_BYPASS,
): RunProfile => {
  const role = sessionRole(session);
  const readOnly = role === "thread" && session.runtime_access_mode === READ_ONLY_ACCESS;
  const accessMode = (pinned: RunAccessMode | undefined): RunAccessMode => {
    // A read-only thread is held read-only by its allow-list, which a bypassed run ignores.
    if (host.skipPermissions && !readOnly) return "full-access";
    return pinned ?? session.runtime_access_mode ?? "full-access";
  };
  if (role === "plain") return { isolation: "open", env: {}, accessMode: accessMode(undefined) };
  const profile = role === "coordinator" ? COORDINATOR_PROFILE : THREAD_PROFILE;
  const tools = toolNamesFor(role).map(claudeMcpToolName);
  return {
    ...profile,
    accessMode: accessMode(profile.accessMode),
    allowedTools: readOnly ? [...tools, ...READ_ONLY_COMMANDS] : tools,
  };
};

/**
 * Whether a run with this profile carries a permission-skipping flag (Claude Code's
 * `--dangerously-skip-permissions`): what `chat_runs.permissions_bypassed` records.
 */
export const bypassesPermissions = (profile: Pick<RunProfile, "accessMode">): boolean =>
  profile.accessMode === "full-access";
