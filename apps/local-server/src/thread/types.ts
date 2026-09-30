import type { Project } from "@aop/common";

export const THREAD_TITLE_MAX = 200;
export const THREAD_MESSAGE_MAX = 20_000;

export type ThreadError =
  | { code: "PROJECT_NOT_FOUND" }
  | { code: "PROJECT_NOT_ACTIVE"; status: Project["status"] }
  | { code: "THREAD_NOT_FOUND" }
  | { code: "INVALID_MESSAGE"; message: string }
  | { code: "REPO_NOT_IN_PROJECT"; repoId: string; repoIds: string[] }
  | { code: "REPO_REQUIRED"; repoIds: string[] }
  | { code: "REPO_UNAVAILABLE"; message: string }
  | { code: "NOT_WAITING" }
  | { code: "NOT_RATE_LIMITED" }
  | { code: "SEND_FAILED"; reason: string }
  | { code: "SESSION_BUSY"; sessionId: string }
  /** The thread has no repository, so there is no branch to publish. */
  | { code: "NO_REPOSITORY" }
  | { code: "WORKTREE_FAILED"; message: string }
  | { code: "NOTHING_TO_PUBLISH" }
  | { code: "NO_PULL_REQUEST" }
  /** `reason` is the session-git code (GH_UNAVAILABLE, PUSH_FAILED, CHECKS_FAILING, ...). */
  | { code: "PULL_REQUEST_FAILED"; reason: string; message: string }
  | { code: "PULL_REQUEST_CLOSED" }
  | { code: "PULL_REQUEST_MERGED" }
  /** The branch holds work that its pull request does not. */
  | { code: "UNPUBLISHED_WORK" }
  | { code: "THREAD_BUSY" };

export type ThreadResult<T> = ({ success: true } & T) | { success: false; error: ThreadError };
