import type {
  PullRequestCommentBody,
  PullRequestMergeBody,
  PullRequestReviewBody,
  PullRequestUpdateBody,
} from "@aop/common";
import { type GhRead, readGhOutput } from "../github-cli/read.ts";
import type { RunGh } from "../github-cli/run-gh.ts";

/*
 * What the host owner can do to a pull request, each through the host's `gh` as one GitHub call.
 * GitHub enforces its own rules: a merge its rulesets forbid is refused with GitHub's reason, and
 * AOP never asks for an admin bypass.
 */

export interface PullRequestTarget {
  nameWithOwner: string;
  number: number;
  /** Where `gh` runs; `gh api` needs no checkout, `gh pr` takes the repository by `-R`. */
  cwd: string;
}

export const commentOn = (
  runGh: RunGh,
  { nameWithOwner, number, cwd }: PullRequestTarget,
  { body }: PullRequestCommentBody,
): Promise<GhRead<string>> =>
  readGhOutput(
    runGh,
    ["api", "-X", "POST", `repos/${nameWithOwner}/issues/${number}/comments`, "-f", `body=${body}`],
    cwd,
  );

export const review = (
  runGh: RunGh,
  { nameWithOwner, number, cwd }: PullRequestTarget,
  { event, body = "" }: PullRequestReviewBody,
): Promise<GhRead<string>> =>
  readGhOutput(
    runGh,
    [
      "api",
      "-X",
      "POST",
      `repos/${nameWithOwner}/pulls/${number}/reviews`,
      "-f",
      `event=${event}`,
      "-f",
      `body=${body}`,
    ],
    cwd,
  );

/** Merges if the head is still the one the person saw; GitHub answers 409 when it moved. */
export const merge = (
  runGh: RunGh,
  { nameWithOwner, number, cwd }: PullRequestTarget,
  { method, expectedHeadSha, title, message }: PullRequestMergeBody,
): Promise<GhRead<string>> => {
  const args = [
    "api",
    "-X",
    "PUT",
    `repos/${nameWithOwner}/pulls/${number}/merge`,
    "-f",
    `merge_method=${method}`,
    "-f",
    `sha=${expectedHeadSha}`,
  ];
  if (title) args.push("-f", `commit_title=${title}`);
  if (message) args.push("-f", `commit_message=${message}`);
  return readGhOutput(runGh, args, cwd);
};

/** Renames, closes or reopens through REST; draft and ready need GraphQL, which `gh pr ready` runs. */
export const update = async (
  runGh: RunGh,
  { nameWithOwner, number, cwd }: PullRequestTarget,
  { title, state, draft }: PullRequestUpdateBody,
): Promise<GhRead<string>> => {
  if (title !== undefined || state !== undefined) {
    const args = ["api", "-X", "PATCH", `repos/${nameWithOwner}/pulls/${number}`];
    if (title !== undefined) args.push("-f", `title=${title}`);
    if (state !== undefined) args.push("-f", `state=${state}`);
    const patched = await readGhOutput(runGh, args, cwd);
    if (!patched.ok) return patched;
  }
  if (draft === undefined) return { ok: true, value: "" };
  const ready = ["pr", "ready", String(number), "-R", nameWithOwner];
  return readGhOutput(runGh, draft ? [...ready, "--undo"] : ready, cwd);
};
