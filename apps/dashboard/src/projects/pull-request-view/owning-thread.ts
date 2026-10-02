import type { Thread } from "@aop/common";
import type { PullRequestViewRef } from "../../shell/router";
import { pullRequestOf } from "../selectors";

/** The project's thread whose pull request this is, if one of them opened it. */
export const threadOwningPullRequest = (
  threads: readonly Thread[],
  { repoId, number }: PullRequestViewRef,
): Thread | null =>
  threads.find((thread) => thread.repoId === repoId && pullRequestOf(thread)?.number === number) ??
  null;
