import type {
  GhPullRequestCheck,
  GhPullRequestHead,
  GhReview,
  PullRequestChecksDetailed,
} from "../github-cli/index.ts";
import { checkRunKey, settledFailures } from "./check-runs.ts";

/** What one poll read of an open pull request. */
export interface Snapshot {
  head: GhPullRequestHead;
  checks: PullRequestChecksDetailed;
  reviews: GhReview[];
}

/**
 * Something on the pull request that a fix prompt would answer. `keys` say which occurrence it
 * is, so an answered one is never answered again: a check run, a review, a head commit that
 * conflicts.
 */
export type Trigger =
  | { kind: "checks"; keys: string[]; checks: GhPullRequestCheck[] }
  | { kind: "review"; keys: string[]; reviews: GhReview[] }
  | { kind: "conflict"; keys: string[]; base: string };

/** The triggers the snapshot holds that `handled` (the keys already answered) does not cover. */
export const findTriggers = (snapshot: Snapshot, handled: ReadonlySet<string>): Trigger[] =>
  [
    failingChecks(snapshot, handled),
    requestedChanges(snapshot, handled),
    conflict(snapshot, handled),
  ].filter((trigger): trigger is Trigger => trigger !== null);

const failingChecks = (
  { checks, head }: Snapshot,
  handled: ReadonlySet<string>,
): Trigger | null => {
  const keyOf = (check: GhPullRequestCheck) => checkRunKey(check, head.headSha);
  const fresh = settledFailures(checks.checks).filter((check) => !handled.has(keyOf(check)));
  return fresh.length > 0 ? { kind: "checks", keys: fresh.map(keyOf), checks: fresh } : null;
};

// Only people who work on the repository may send the thread off to change its code: on a public
// repository anyone can review, and what a review says goes to the agent as text to act on.
const TRUSTED_ASSOCIATIONS: ReadonlySet<string> = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// What a review says about the pull request stands until its author says something else. A
// comment does not change it, and GitHub keeps a request for changes in the list as it was after
// the same reviewer approves, so only each reviewer's latest verdict is what is asked for now.
const VERDICTS: ReadonlySet<string> = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

// Only a review that asks for changes starts a fix: a comment is for the person to weigh.
const requestedChanges = ({ reviews }: Snapshot, handled: ReadonlySet<string>): Trigger | null => {
  const standing = new Map<string, GhReview>();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (VERDICTS.has(review.state)) standing.set(review.author, review);
  }
  const fresh = [...standing.values()].filter(
    (review) =>
      review.state === "CHANGES_REQUESTED" &&
      TRUSTED_ASSOCIATIONS.has(review.association) &&
      !handled.has(reviewKey(review)),
  );
  return fresh.length > 0 ? { kind: "review", keys: fresh.map(reviewKey), reviews: fresh } : null;
};

// The head commit is part of the key: a fix that is pushed and still conflicts is a new attempt,
// and a thread that pushed nothing is not asked again.
const conflict = ({ head }: Snapshot, handled: ReadonlySet<string>): Trigger | null => {
  const key = `conflict:${head.headSha}`;
  return head.mergeable === "CONFLICTING" && !handled.has(key)
    ? { kind: "conflict", keys: [key], base: head.baseRefName }
    : null;
};

const reviewKey = (review: GhReview): string => `review:${review.id}`;
