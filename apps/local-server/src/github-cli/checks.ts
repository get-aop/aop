import type { RunGh } from "./run-gh.ts";

export interface GhPullRequestCheck {
  name: string;
  workflow: string;
  state: string;
  bucket: string;
  link: string;
  startedAt: string | null;
  completedAt: string | null;
  description: string | null;
}

export const listPullRequestChecks = async (
  runGh: RunGh,
  repoPath: string,
  branchName: string,
): Promise<GhPullRequestCheck[]> => {
  const detailed = await listPullRequestChecksDetailed(runGh, repoPath, branchName);
  return detailed.checks;
};

export interface PullRequestChecksDetailed {
  /** False when gh reports the branch has no checks at all (repos without CI). */
  reported: boolean;
  checks: GhPullRequestCheck[];
}

const NO_CHECKS_PATTERN = /no checks reported/i;

export const listPullRequestChecksDetailed = async (
  runGh: RunGh,
  repoPath: string,
  branchName: string,
): Promise<PullRequestChecksDetailed> => {
  const result = await runGh(
    [
      "pr",
      "checks",
      branchName,
      "--json",
      "name,state,workflow,link,startedAt,completedAt,bucket,description",
    ],
    repoPath,
  );
  // gh exits non-zero with "no checks reported" when the branch has no CI at all.
  if (NO_CHECKS_PATTERN.test(result.stderr)) return { reported: false, checks: [] };
  // gh prints the JSON payload even on non-zero exits (pending = 8, failing = 1).
  const parsed = parseChecksJson(result.stdout);
  if (parsed) return { reported: true, checks: parsed };
  // Unstructured failure (auth, network): preserve the legacy empty/pending view.
  return { reported: true, checks: [] };
};

const parseChecksJson = (stdout: string): GhPullRequestCheck[] | null => {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as GhPullRequestCheck[]) : null;
  } catch {
    return null;
  }
};

export const summarizePullRequestChecks = (
  checks: GhPullRequestCheck[],
): {
  state: "pending" | "success" | "failure";
  pendingCount: number;
  failingCount: number;
  successfulCount: number;
  headline: string;
} => {
  const pendingCount = checks.filter((check) => isPendingCheck(check)).length;
  const failingCount = checks.filter((check) => isFailingCheck(check)).length;
  const successfulCount = checks.filter((check) => isSuccessfulCheck(check)).length;

  if (checks.length === 0) {
    return {
      state: "pending",
      pendingCount: 1,
      failingCount: 0,
      successfulCount: 0,
      headline: "Waiting for checks to start…",
    };
  }

  if (pendingCount > 0) {
    return {
      state: "pending",
      pendingCount,
      failingCount,
      successfulCount,
      headline: "Checks are running",
    };
  }

  if (failingCount > 0) {
    return {
      state: "failure",
      pendingCount,
      failingCount,
      successfulCount,
      headline:
        failingCount === 1 && successfulCount === 0
          ? "Some checks were not successful"
          : `${failingCount} failing, ${successfulCount} successful checks`,
    };
  }

  return {
    state: "success",
    pendingCount,
    failingCount,
    successfulCount,
    headline: "All checks have passed",
  };
};

const isPendingCheck = (check: GhPullRequestCheck): boolean => {
  const state = check.state.toUpperCase();
  return (
    check.bucket === "pending" ||
    state === "PENDING" ||
    state === "IN_PROGRESS" ||
    state === "QUEUED" ||
    state === "WAITING"
  );
};

const isFailingCheck = (check: GhPullRequestCheck): boolean => {
  const state = check.state.toUpperCase();
  return (
    check.bucket === "fail" || state === "FAILURE" || state === "ERROR" || state === "TIMED_OUT"
  );
};

const REVIEW_APPROVAL_PATTERN = /approv|review.?required|required.?review|codeowner|reviewer/i;

/**
 * Branch-protection gates like "PR review approver" or "senior approver" fail
 * until a human approves — pushing code cannot fix them, so they must not make
 * the agent-driven "Fix CI" path available on their own.
 */
export const isReviewApprovalCheck = (check: GhPullRequestCheck): boolean =>
  REVIEW_APPROVAL_PATTERN.test(check.name) ||
  REVIEW_APPROVAL_PATTERN.test(check.workflow) ||
  REVIEW_APPROVAL_PATTERN.test(check.description ?? "");

export const listFixableFailingChecks = (checks: GhPullRequestCheck[]): GhPullRequestCheck[] =>
  checks.filter((check) => isFailingCheck(check) && !isReviewApprovalCheck(check));

const isSuccessfulCheck = (check: GhPullRequestCheck): boolean => {
  const state = check.state.toUpperCase();
  return check.bucket === "pass" || state === "SUCCESS";
};
