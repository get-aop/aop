/**
 * Thin re-export layer over the shared github-cli module so existing
 * task-domain imports and `mock.module("./pr-github.ts", ...)` keep working.
 */
export type {
  CommandResult,
  GhPullRequestCheck,
  GhPullRequestRef,
  RunGh,
} from "../github-cli/index.ts";
export {
  defaultRunGh,
  findPullRequestByHead,
  isGhAuthenticated,
  isReviewApprovalCheck,
  listFixableFailingChecks,
  listPullRequestChecks,
  mergePullRequest,
  reopenPullRequest,
  summarizePullRequestChecks,
  updatePullRequestBranch,
} from "../github-cli/index.ts";
