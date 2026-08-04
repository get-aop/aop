import { resolve as resolvePath } from "node:path";
import type { SessionGitDiffstat, SessionGitPullRequest, SessionGitStatus } from "@aop/common";
import { getLogger } from "@aop/infra";
import {
  resolveSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "../chat-session/workspace-binding.ts";
import { defaultGitRunner, type RunCommand } from "../command-runner.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { defaultRunGh, findPullRequestByHead, type RunGh } from "../github-cli/index.ts";
import {
  MACHINE_READABLE_GIT_DIFF_FLAGS,
  resolveDefaultBranch,
  resolveMergeBase,
} from "./git-helpers.ts";
import {
  resolveSessionPrContext,
  type SessionPrPreconditionError,
} from "./pull-request-context.ts";

const logger = getLogger("session-git", "service");
const GH_AVAILABILITY_TTL_MS = 60_000;
/** In-flight promise shares until resolved; TTL starts only after resolution. */
const ghAvailabilityCache = new WeakMap<
  RunGh,
  { resolvedAt: number | null; value: Promise<boolean> }
>();
const statusRequests = new WeakMap<
  RunGit,
  WeakMap<RunGh, Map<string, Promise<SessionGitStatus>>>
>();

export type {
  SessionGitDiffstat,
  SessionGitPullRequest,
  SessionGitStatus,
} from "@aop/common";
export type { CommandResult } from "../command-runner.ts";

export type RunGit = RunCommand;

export type GetSessionGitStatusResult =
  | { success: true; status: SessionGitStatus }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | {
            code: "WORKSPACE_BINDING_ERROR";
            message: string;
            path: string | null;
            resettable: boolean;
          };
    };

const emptyDiffstat = (): SessionGitDiffstat => ({
  filesChanged: 0,
  additions: 0,
  deletions: 0,
});

const nonGitStatus = (ghAvailable: boolean): SessionGitStatus => ({
  isGitRepo: false,
  branch: null,
  defaultBranch: null,
  isOnDefaultBranch: false,
  dirty: false,
  diffstat: emptyDiffstat(),
  aheadOfBase: 0,
  ghAvailable,
  pr: null,
  prState: null,
});

export const defaultRunGit: RunGit = defaultGitRunner;

export type CommitSessionChangesResult =
  | { success: true; result: { committed: true; pushed: boolean; branch: string } }
  | {
      success: false;
      error:
        | SessionPrPreconditionError
        | { code: "NO_CHANGES" }
        | { code: "DIRTY_MAIN_CHECKOUT"; message: string }
        | { code: "GIT_FAILED"; message: string }
        | { code: "PUSH_FAILED"; message: string };
    };

export const commitSessionChanges = async (
  ctx: LocalServerContext,
  sessionId: string,
  input: { push: boolean },
  runGit: RunGit = defaultRunGit,
): Promise<CommitSessionChangesResult> => {
  const resolved = await resolveSessionPrContext(ctx, sessionId, runGit);
  if (!resolved.ok) return { success: false, error: resolved.error };
  const { workspace, branch, sessionTitle } = resolved.context;
  if (!branch || !(await isLinkedWorktree(runGit, workspace))) {
    return {
      success: false,
      error: {
        code: "DIRTY_MAIN_CHECKOUT",
        message: "Create a session worktree before committing changes",
      },
    };
  }

  const committed = await stageAndCommitChanges(runGit, workspace, sessionTitle);
  if (!committed.ok) return { success: false, error: committed.error };
  if (!committed.committed) return { success: false, error: { code: "NO_CHANGES" } };

  if (input.push) {
    const pushed = await runGit(["push", "-u", "origin", `HEAD:refs/heads/${branch}`], workspace);
    if (pushed.exitCode !== 0) {
      return {
        success: false,
        error: { code: "PUSH_FAILED", message: pushed.stderr.trim() || "git push failed" },
      };
    }
  }
  return { success: true, result: { committed: true, pushed: input.push, branch } };
};

export const stageAndCommitChanges = async (
  runGit: RunGit,
  workspace: string,
  sessionTitle: string,
): Promise<
  { ok: true; committed: boolean } | { ok: false; error: { code: "GIT_FAILED"; message: string } }
> => {
  const status = await runGit(["status", "--porcelain"], workspace);
  if (status.exitCode !== 0) {
    return {
      ok: false,
      error: { code: "GIT_FAILED", message: status.stderr.trim() || "git status failed" },
    };
  }
  if (!status.stdout.trim()) return { ok: true, committed: false };

  const add = await runGit(["add", "-A"], workspace);
  if (add.exitCode !== 0) {
    return {
      ok: false,
      error: { code: "GIT_FAILED", message: add.stderr.trim() || "git add failed" },
    };
  }
  const commit = await runGit(["commit", "-m", buildCommitMessage(sessionTitle)], workspace);
  if (commit.exitCode !== 0) {
    return {
      ok: false,
      error: { code: "GIT_FAILED", message: commit.stderr.trim() || "git commit failed" },
    };
  }
  return { ok: true, committed: true };
};

/** A linked worktree has its git dir under the main checkout's .git/worktrees. */
export const isLinkedWorktree = async (runGit: RunGit, workspace: string): Promise<boolean> => {
  const [gitDir, commonDir] = await Promise.all([
    runGit(["rev-parse", "--git-dir"], workspace),
    runGit(["rev-parse", "--git-common-dir"], workspace),
  ]);
  if (gitDir.exitCode !== 0 || commonDir.exitCode !== 0) return false;
  return (
    resolvePath(workspace, gitDir.stdout.trim()) !== resolvePath(workspace, commonDir.stdout.trim())
  );
};

export const buildCommitMessage = (sessionTitle: string): string => {
  const title = sessionTitle.trim();
  if (!title) return "AOP session changes";
  const message = `chore(session): ${title}`;
  return message.length > 72 ? `${message.slice(0, 71)}…` : message;
};

/** Git status for the session workspace: merge-base(default, HEAD) → working tree. */
export const getSessionGitStatus = async (
  ctx: LocalServerContext,
  sessionId: string,
  runGit: RunGit = defaultRunGit,
  runGh: RunGh = defaultRunGh,
): Promise<GetSessionGitStatusResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) {
    return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  }

  let workspace: string;
  try {
    workspace = await resolveSessionWorkspace(ctx, session);
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return {
        success: false,
        error: {
          code: "WORKSPACE_BINDING_ERROR",
          message: error.message,
          path: error.path,
          resettable: error.resettable,
        },
      };
    }
    throw error;
  }

  return {
    success: true,
    status: await readGitStatusCoalesced(runGit, runGh, workspace),
  };
};

const resolveSessionWorkspace = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<string> => resolveSessionWorkspaceBinding(ctx, session);

const readGitStatusCoalesced = (
  runGit: RunGit,
  runGh: RunGh,
  workspace: string,
): Promise<SessionGitStatus> => {
  let byGh = statusRequests.get(runGit);
  if (!byGh) {
    byGh = new WeakMap();
    statusRequests.set(runGit, byGh);
  }
  let byWorkspace = byGh.get(runGh);
  if (!byWorkspace) {
    byWorkspace = new Map();
    byGh.set(runGh, byWorkspace);
  }
  const existing = byWorkspace.get(workspace);
  if (existing) return existing;

  const request = readGitStatus(runGit, runGh, workspace).finally(() => {
    if (byWorkspace?.get(workspace) === request) byWorkspace.delete(workspace);
  });
  byWorkspace.set(workspace, request);
  return request;
};

const readGitStatus = async (
  runGit: RunGit,
  runGh: RunGh,
  workspace: string,
): Promise<SessionGitStatus> => {
  const [branchResult, defaultBranch, statusResult] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], workspace),
    resolveDefaultBranch(runGit, workspace),
    runGit(["status", "--porcelain"], workspace),
  ]);
  if (statusResult.exitCode !== 0) return nonGitStatus(false);

  const branchRaw = branchResult.exitCode === 0 ? branchResult.stdout.trim() : "";
  const branch = branchRaw && branchRaw !== "HEAD" ? branchRaw : null;
  const isOnDefaultBranch = Boolean(branch && defaultBranch && branch === defaultBranch);
  const dirty = statusResult.stdout.trim().length > 0;
  // ghAvailable is CLI auth availability, not PR eligibility. Always check
  // (with TTL cache); still skip pr list on the default branch.
  const ghAvailablePromise = readGhAvailable(runGh, workspace);
  // Start PR lookup as soon as auth resolves so it overlaps local merge-base work:
  // latency ≈ max(local Git, gh auth + PR) rather than max(local Git, auth) + PR.
  const prPromise = ghAvailablePromise.then(async (ghAvailable) => {
    if (!ghAvailable || !branch || isOnDefaultBranch) return null;
    return readPullRequest(runGh, workspace, branch);
  });
  const baseRelativePromise = readBaseRelativeStatus(runGit, workspace, {
    isGitRepo: true,
    branch,
    defaultBranch,
    isOnDefaultBranch,
    dirty,
    ghAvailable: false,
    pr: null,
    prState: null,
  });
  const [ghAvailable, relative, pr] = await Promise.all([
    ghAvailablePromise,
    baseRelativePromise,
    prPromise,
  ]);

  return {
    ...relative,
    ghAvailable,
    pr,
    prState: pr ? (pr.state.toLowerCase() as "open" | "closed" | "merged") : null,
  };
};

/** Diffstat + ahead count against the merge-base, with graceful degradation. */
const readBaseRelativeStatus = async (
  runGit: RunGit,
  workspace: string,
  base: Omit<SessionGitStatus, "diffstat" | "aheadOfBase">,
): Promise<SessionGitStatus> => {
  const baseRef = base.defaultBranch ?? base.branch;
  if (!baseRef) {
    return { ...base, diffstat: emptyDiffstat(), aheadOfBase: 0 };
  }

  const mergeBase = await resolveMergeBase(runGit, workspace, baseRef);
  if (!mergeBase) {
    logger.warn("Could not resolve merge base for session workspace {workspace}", { workspace });
    return { ...base, diffstat: emptyDiffstat(), aheadOfBase: 0 };
  }

  const [diffstat, aheadOfBase] = await Promise.all([
    readDiffstat(runGit, workspace, mergeBase),
    readAheadCount(runGit, workspace, mergeBase),
  ]);

  return { ...base, diffstat, aheadOfBase };
};

const readCachedGhAvailable = (runGh: RunGh): Promise<boolean> | null => {
  const cached = ghAvailabilityCache.get(runGh);
  if (!cached) return null;
  if (cached.resolvedAt === null) return cached.value;
  if (Date.now() - cached.resolvedAt < GH_AVAILABILITY_TTL_MS) return cached.value;
  return null;
};

const readGhAvailable = (runGh: RunGh, workspace: string): Promise<boolean> => {
  const cached = readCachedGhAvailable(runGh);
  if (cached) return cached;

  const entry: { resolvedAt: number | null; value: Promise<boolean> } = {
    resolvedAt: null,
    value: Promise.resolve(false),
  };
  entry.value = runGh(["auth", "status"], workspace)
    .then((result) => result.exitCode === 0)
    .catch(() => false)
    .finally(() => {
      entry.resolvedAt = Date.now();
    });
  ghAvailabilityCache.set(runGh, entry);
  return entry.value;
};

/** Best-effort PR lookup: any gh failure degrades to null, never fails the status call. */
const readPullRequest = async (
  runGh: RunGh,
  workspace: string,
  branch: string,
): Promise<SessionGitPullRequest | null> => {
  try {
    const pullRequest = await findPullRequestByHead(runGh, workspace, branch);
    if (!pullRequest) return null;
    return {
      number: pullRequest.number,
      url: pullRequest.url,
      state: pullRequest.state,
      title: pullRequest.title,
    };
  } catch {
    return null;
  }
};

const readDiffstat = async (
  runGit: RunGit,
  cwd: string,
  mergeBase: string,
): Promise<SessionGitDiffstat> => {
  const result = await runGit(
    ["diff", ...MACHINE_READABLE_GIT_DIFF_FLAGS, "--numstat", mergeBase],
    cwd,
  );
  if (result.exitCode !== 0) return emptyDiffstat();

  const tracked = parseNumstat(result.stdout);
  const untracked = await readUntrackedDiffstat(runGit, cwd);
  return {
    filesChanged: tracked.filesChanged + untracked.filesChanged,
    additions: tracked.additions + untracked.additions,
    deletions: tracked.deletions + untracked.deletions,
  };
};

const parseNumstat = (stdout: string): SessionGitDiffstat => {
  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of stdout.split("\n")) {
    const parsed = parseNumstatLine(line);
    if (!parsed) continue;
    filesChanged += 1;
    additions += parsed.additions;
    deletions += parsed.deletions;
  }
  return { filesChanged, additions, deletions };
};

const parseNumstatLine = (line: string): { additions: number; deletions: number } | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const [addRaw, delRaw] = trimmed.split("\t");
  if (addRaw === undefined || delRaw === undefined) return null;
  return {
    additions: addRaw === "-" ? 0 : Number.parseInt(addRaw, 10) || 0,
    deletions: delRaw === "-" ? 0 : Number.parseInt(delRaw, 10) || 0,
  };
};

const readUntrackedDiffstat = async (runGit: RunGit, cwd: string): Promise<SessionGitDiffstat> => {
  // Untracked files are not in `git diff`; count them so dirty workspaces show a chip.
  const untracked = await runGit(
    ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", "."],
    cwd,
  );
  if (untracked.exitCode !== 0) return emptyDiffstat();

  let filesChanged = 0;
  let additions = 0;
  for (const path of untracked.stdout.split("\n")) {
    const relativePath = path.trim();
    if (!relativePath) continue;
    filesChanged += 1;
    additions += await countFileLines(cwd, relativePath);
  }
  return { filesChanged, additions, deletions: 0 };
};

const BINARY_SNIFF_BYTES = 8000;

const countFileLines = async (cwd: string, relativePath: string): Promise<number> => {
  try {
    const file = Bun.file(`${cwd}/${relativePath}`);
    if (!(await file.exists())) return 0;
    const head = new Uint8Array(await file.slice(0, BINARY_SNIFF_BYTES).arrayBuffer());
    // Binary files get git's `-` numstat treatment: counted as changed, zero lines.
    if (head.includes(0)) return 0;
    const text = await file.text();
    if (!text) return 0;
    // Match `git diff --numstat` line counting for text files (trailing newline).
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return 0;
  }
};

const readAheadCount = async (runGit: RunGit, cwd: string, mergeBase: string): Promise<number> => {
  const result = await runGit(["rev-list", "--count", `${mergeBase}..HEAD`], cwd);
  if (result.exitCode !== 0) return 0;
  return Number.parseInt(result.stdout.trim(), 10) || 0;
};
