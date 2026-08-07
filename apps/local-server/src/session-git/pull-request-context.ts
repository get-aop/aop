import {
  resolveSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "../chat-session/workspace-binding.ts";
import type { LocalServerContext } from "../context.ts";
import type { RunGh } from "../github-cli/index.ts";
import { resolveDefaultBranch } from "./git-helpers.ts";
import type { RunGit } from "./service.ts";

export type SessionPrPreconditionError =
  | { code: "SESSION_NOT_FOUND" }
  | {
      code: "WORKSPACE_BINDING_ERROR";
      message: string;
      path: string | null;
      resettable: boolean;
    }
  | { code: "NOT_A_GIT_REPO"; message: string };

export interface SessionPrContext {
  workspace: string;
  /** Current branch, or null on detached HEAD. */
  branch: string | null;
  defaultBranch: string | null;
  sessionTitle: string;
}

export type ResolveSessionPrContextResult =
  | { ok: true; context: SessionPrContext }
  | { ok: false; error: SessionPrPreconditionError };

type GhAvailability = { ok: true } | { ok: false; message: string };

const GH_AVAILABILITY_CACHE_TTL_MS = 60_000;
const ghAvailabilityCache = new WeakMap<
  RunGh,
  { expiresAt: number; result: Promise<GhAvailability> }
>();

/** Session → workspace → git preconditions shared by all session PR operations. */
export const resolveSessionPrContext = async (
  ctx: LocalServerContext,
  sessionId: string,
  runGit: RunGit,
): Promise<ResolveSessionPrContextResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) {
    return { ok: false, error: { code: "SESSION_NOT_FOUND" } };
  }

  let workspace: string;
  try {
    workspace = await resolveSessionWorkspaceBinding(ctx, session);
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return {
        ok: false,
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

  const repositoryState = await runGit(
    ["rev-parse", "--is-inside-work-tree", "--abbrev-ref", "HEAD"],
    workspace,
  );
  const [inside, branchRaw = ""] = repositoryState.stdout.trim().split(/\r?\n/);
  if (repositoryState.exitCode !== 0 || inside !== "true") {
    return {
      ok: false,
      error: {
        code: "NOT_A_GIT_REPO",
        message: "Session workspace is not a git repository",
      },
    };
  }

  const branch = branchRaw && branchRaw !== "HEAD" ? branchRaw : null;
  const defaultBranch = await resolveDefaultBranch(runGit, workspace);

  return {
    ok: true,
    context: { workspace, branch, defaultBranch, sessionTitle: session.title ?? "" },
  };
};

/** gh availability via the injectable seam so tests never touch the real CLI. */
export const checkGhAvailable = async (runGh: RunGh, cwd: string): Promise<GhAvailability> => {
  const cached = ghAvailabilityCache.get(runGh);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const result = runGh(["auth", "status"], cwd)
    .then<GhAvailability>((command) => {
      if (command.exitCode === 0) return { ok: true };
      return {
        ok: false,
        message: command.stderr.trim() || command.stdout.trim() || "GitHub CLI is unavailable",
      };
    })
    .catch((error) => {
      ghAvailabilityCache.delete(runGh);
      throw error;
    });
  ghAvailabilityCache.set(runGh, {
    expiresAt: Date.now() + GH_AVAILABILITY_CACHE_TTL_MS,
    result,
  });
  return result;
};
