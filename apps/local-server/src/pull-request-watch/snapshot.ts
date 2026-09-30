import {
  type GhRead,
  listPullRequestReviews,
  type RunGh,
  readPullRequestChecks,
  readPullRequestHead,
} from "../github-cli/index.ts";
import type { Snapshot } from "./triggers.ts";

/**
 * Reads a pull request as GitHub has it. A pull request that is not open has no checks or
 * reviews worth reading, so those calls are left out: the head tells the watcher it is over.
 */
export const readSnapshot = async (
  runGh: RunGh,
  repoPath: string,
  pullRequestNumber: number,
): Promise<GhRead<Snapshot>> => {
  const head = await readPullRequestHead(runGh, repoPath, pullRequestNumber);
  if (!head.ok) return head;
  if (head.value.state !== "OPEN") {
    return {
      ok: true,
      value: { head: head.value, checks: { reported: false, checks: [] }, reviews: [] },
    };
  }
  const [checks, reviews] = await Promise.all([
    readPullRequestChecks(runGh, repoPath, String(pullRequestNumber)),
    listPullRequestReviews(runGh, repoPath, pullRequestNumber),
  ]);
  if (!checks.ok) return checks;
  if (!reviews.ok) return reviews;
  return { ok: true, value: { head: head.value, checks: checks.value, reviews: reviews.value } };
};
