import type { ChatSessionDetail, CreateSessionPrMode, SessionGitStatus } from "../../api/client";
import type { SessionPullRequestController } from "./use-session-pull-request";
export const resolveSourceControlState = (
  session: ChatSessionDetail,
  gitStatus: SessionGitStatus | null,
  pr: SessionPullRequestController | null,
  busy: boolean,
) => {
  const worktreeReady = Boolean(
    session.workspacePath && session.workspacePath !== session.repoPath && gitStatus?.isGitRepo,
  );
  const dirty = Boolean(gitStatus?.dirty);
  const trackedPr = pr?.status?.pr ?? gitStatus?.pr ?? null;
  const prState = trackedPr?.state ?? null;
  const prClosed = prState === "OPEN" || prState === "MERGED" || prState === "CLOSED";
  const canCreatePr = canCreatePullRequest({
    hasController: Boolean(pr),
    worktreeReady,
    gitStatus,
    prClosed,
    dirty,
  });
  const canCommit = worktreeReady && dirty && !busy;
  return {
    canCommit,
    canCommitPush: canCommit && gitStatus?.ghAvailable !== false,
    canCreatePr,
    prUrl: prState === "OPEN" ? (trackedPr?.url ?? null) : null,
    quick: resolveSourceControlQuickAction({
      worktreeReady,
      dirty,
      canCreatePr,
      busy,
      gitStatus,
      openPr: prState === "OPEN",
    }),
  };
};

export const canCreatePullRequest = ({
  hasController,
  worktreeReady,
  gitStatus,
  prClosed,
  dirty,
}: {
  hasController: boolean;
  worktreeReady: boolean;
  gitStatus: SessionGitStatus | null;
  prClosed: boolean;
  dirty: boolean;
}): boolean =>
  Boolean(
    hasController &&
      worktreeReady &&
      !gitStatus?.isOnDefaultBranch &&
      gitStatus?.ghAvailable &&
      !prClosed &&
      (dirty || (gitStatus?.aheadOfBase ?? 0) > 0),
  );

export const runQuickSourceControlAction = (
  action: "commit" | "commit-push" | "create-pr" | "view-pr" | null,
  commit: (push: boolean) => Promise<void>,
  createPr: (mode: CreateSessionPrMode) => Promise<void>,
  viewPr: () => void,
) => {
  if (action === "commit") void commit(false);
  if (action === "commit-push") void commit(true);
  if (action === "create-pr") void createPr("create");
  if (action === "view-pr") viewPr();
};

export const resolveSourceControlQuickAction = ({
  worktreeReady,
  dirty,
  canCreatePr,
  busy,
  gitStatus,
  openPr,
}: {
  worktreeReady: boolean;
  dirty: boolean;
  canCreatePr: boolean;
  busy: boolean;
  gitStatus: SessionGitStatus | null;
  openPr: boolean;
}): {
  label: string;
  disabled: boolean;
  hint: string | null;
  action: "commit" | "commit-push" | "create-pr" | "view-pr" | null;
} => {
  if (!worktreeReady) {
    return {
      label: "Commit",
      disabled: true,
      hint: "Create a session worktree before committing.",
      action: null,
    };
  }
  if (busy) return { label: "Git…", disabled: true, hint: "Git action in progress.", action: null };
  if (canCreatePr) {
    return {
      label: dirty ? "Commit, push & PR" : "Create PR",
      disabled: false,
      hint: null,
      action: "create-pr",
    };
  }
  if (dirty) {
    return {
      label: "Commit & push",
      disabled: false,
      hint: null,
      action: gitStatus?.ghAvailable === false ? "commit" : "commit-push",
    };
  }
  if (openPr) {
    return { label: "View PR", disabled: false, hint: null, action: "view-pr" };
  }
  return {
    label: "Commit",
    disabled: true,
    hint: "Working tree is clean.",
    action: null,
  };
};
