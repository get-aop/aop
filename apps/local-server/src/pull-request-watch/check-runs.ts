import type { PullRequestChecks } from "@aop/common";
import {
  type GhPullRequestCheck,
  listFixableFailingChecks,
  type PullRequestChecksDetailed,
  summarizePullRequestChecks,
} from "../github-cli/index.ts";

/** What the thread's pull request artifact shows; null for a repository whose pull requests have no checks. */
export const summarizeChecks = (detail: PullRequestChecksDetailed): PullRequestChecks | null => {
  if (!detail.reported || detail.checks.length === 0) return null;
  const { state, pendingCount, failingCount, successfulCount } = summarizePullRequestChecks(
    detail.checks,
  );
  return { state, pending: pendingCount, failing: failingCount, successful: successfulCount };
};

/**
 * Which run of a check this is, on which commit. The same run seen on every poll has one key, and a
 * new run of the same check (a push, a re-run) has another, which is what lets a failure be
 * answered once. The commit is part of it because a commit status has no run of its own: its link
 * and its times can be the same on the next commit, which must not read as the failure answered.
 */
export const checkRunKey = (check: GhPullRequestCheck, headSha: string): string =>
  `check:${check.name}|${check.link}|${check.completedAt ?? check.startedAt ?? ""}|${headSha}`;

/**
 * The failing checks a push could fix, once nothing is still running: a fix waits for the whole
 * round, so one prompt names every failure, and an approval gate is not something to fix.
 */
export const settledFailures = (checks: readonly GhPullRequestCheck[]): GhPullRequestCheck[] => {
  const all = [...checks];
  return summarizePullRequestChecks(all).state === "failure" ? listFixableFailingChecks(all) : [];
};

export const sameChecks = (
  a: PullRequestChecks | undefined,
  b: PullRequestChecks | null,
): boolean =>
  a === undefined
    ? b === null
    : b !== null &&
      a.state === b.state &&
      a.successful === b.successful &&
      a.failing === b.failing &&
      a.pending === b.pending;
