import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import type { CommandResult, RunGh } from "../github-cli/index.ts";
import type { RunGit } from "./service.ts";

export const okResult = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });

export const failResult = (stderr: string, exitCode = 1): CommandResult => ({
  exitCode,
  stdout: "",
  stderr,
});

/** Session PR tests must never call the real gh CLI. */
export const unavailableGh: RunGh = async () => failResult("gh not logged in");

export interface FakeGitConfig {
  branch?: string;
  dirty?: boolean;
  remoteUrl?: string;
  pushFails?: boolean;
  /** When true, the workspace is the user's main checkout (not a linked worktree). */
  mainCheckout?: boolean;
}

/** Deterministic git seam: a workspace on a feature branch of a GitHub-remoted repo. */
export const createFakeGit = (config: FakeGitConfig = {}) => {
  const calls: string[][] = [];
  const responses: Record<string, () => CommandResult> = {
    "rev-parse --is-inside-work-tree": () => okResult("true\n"),
    "rev-parse --abbrev-ref HEAD": () => okResult(`${config.branch ?? "feature/x"}\n`),
    "rev-parse --git-dir": () =>
      okResult(config.mainCheckout ? "/repo/.git\n" : "/repo/.git/worktrees/wt\n"),
    "rev-parse --git-common-dir": () => okResult("/repo/.git\n"),
    "for-each-ref --format=%(refname)%09%(symref) refs/remotes/origin/HEAD refs/heads/main refs/heads/master":
      () => okResult("refs/remotes/origin/HEAD\trefs/remotes/origin/main\nrefs/heads/main\t\n"),
    "status --porcelain": () => okResult(config.dirty ? " M src/a.ts\n" : ""),
    "remote get-url origin": () =>
      okResult(`${config.remoteUrl ?? "git@github.com:acme/widget.git"}\n`),
  };
  const run: RunGit = async (args) => {
    calls.push(args);
    if (args[0] === "push") {
      return config.pushFails ? failResult("push rejected") : okResult();
    }
    // `-c key=value` config prefixes (e.g. core.quotepath=false) don't change the command.
    const normalized = args[0] === "-c" ? args.slice(2) : args;
    return responses[normalized.join(" ")]?.() ?? okResult();
  };
  return { run, calls };
};

/** Scripted gh seam; returning null from the handler means "unexpected call". */
export const createFakeGh = (
  handler: (args: string[], callNumber: number) => CommandResult | null,
) => {
  const calls: string[][] = [];
  const run: RunGh = async (args) => {
    calls.push(args);
    return handler(args, calls.length) ?? failResult("unexpected gh call");
  };
  return { run, calls };
};

export type GhCommandKey =
  | "auth status"
  | "pr list"
  | "pr create"
  | "pr checks"
  | "pr view"
  | "pr merge";

/** A single canned response, or a queue drained in call order (last entry sticks). */
export type GhScriptValue = CommandResult | CommandResult[];

/**
 * Declarative gh script keyed by command (`pr list`, `pr create`, …) so test
 * bodies stay branch-free. `auth status` defaults to ok; unscripted commands
 * count as unexpected calls.
 */
export const createPrWorkflowGh = (script: Partial<Record<GhCommandKey, GhScriptValue>> = {}) => {
  const responses = new Map<GhCommandKey, CommandResult[]>();
  for (const [key, value] of Object.entries(script)) {
    responses.set(key as GhCommandKey, Array.isArray(value) ? [...value] : [value]);
  }
  if (!responses.has("auth status")) responses.set("auth status", [okResult()]);

  return createFakeGh((args) => {
    const key = `${args[0]} ${args[1]}` as GhCommandKey;
    const queue = responses.get(key);
    if (!queue || queue.length === 0) return null;
    const head = queue[0] ?? null;
    if (queue.length > 1) queue.shift();
    return head;
  });
};

export const setupPrSession = async (options: { title?: string } = {}) => {
  const db = await createTestDb();
  const ctx = createCommandContext(db);
  const repoPath = join(tmpdir(), `aop-session-pr-${crypto.randomUUID()}`);
  await mkdir(repoPath, { recursive: true });
  await createTestRepo(db, "repo_session_pr", repoPath);

  const now = new Date().toISOString();
  const session = await ctx.chatSessionRepository.create({
    id: `csess_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
    repo_id: "repo_session_pr",
    title: options.title ?? "Session PR test",
    named: false,
    runtime: "claude-code",
    model: "claude-opus-4-8",
    reasoning_effort: "medium",
    runtime_alias: null,
    runtime_session_id: null,
    runtime_configuration_id: null,
    fast_mode: false,
    pinned: false,
    settled_override: null,
    settled_at: null,
    default_worker_id: null,
    default_workflow_id: null,
    workspace_path: null,
    created_at: now,
    updated_at: now,
  });

  return { db, ctx, repoPath, sessionId: session.id };
};

export const teardownPrSession = async (
  db: Awaited<ReturnType<typeof createTestDb>>,
  repoPath: string,
) => {
  await db.destroy();
  await rm(repoPath, { recursive: true, force: true });
};
