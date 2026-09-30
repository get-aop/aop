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
  | { code: "SEND_FAILED"; reason: string };

export type ThreadResult<T> = ({ success: true } & T) | { success: false; error: ThreadError };
