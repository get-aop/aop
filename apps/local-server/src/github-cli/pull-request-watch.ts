import { z } from "zod";
import { parseJsonPages } from "./json-pages.ts";
import { type GhRead, ghFailure, readGhOutput } from "./read.ts";
import type { RunGh } from "./run-gh.ts";

/*
 * What the pull request watcher reads from GitHub, one call each. A read that fails says why
 * and whether GitHub is throttling, so the watcher can back off; it never throws.
 */

const HeadSchema = z.object({
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  // "MERGEABLE", "CONFLICTING", or "UNKNOWN" while GitHub is still working it out.
  mergeable: z.string().default("UNKNOWN"),
  headRefOid: z.string().min(1),
  baseRefName: z.string().default(""),
});

export interface GhPullRequestHead {
  state: "OPEN" | "CLOSED" | "MERGED";
  mergeable: string;
  headSha: string;
  baseRefName: string;
}

/** The pull request's state and the commit its head is at, in one `gh pr view`. */
export const readPullRequestHead = async (
  runGh: RunGh,
  repoPath: string,
  pullRequestNumber: number,
): Promise<GhRead<GhPullRequestHead>> => {
  const output = await readGhOutput(
    runGh,
    ["pr", "view", String(pullRequestNumber), "--json", "state,mergeable,headRefOid,baseRefName"],
    repoPath,
  );
  if (!output.ok) return output;
  const parsed = HeadSchema.safeParse(safeJson(output.value));
  if (!parsed.success) return ghFailure("GitHub CLI returned malformed pull request JSON");
  const { state, mergeable, headRefOid, baseRefName } = parsed.data;
  return { ok: true, value: { state, mergeable, headSha: headRefOid, baseRefName } };
};

const ReviewSchema = z.object({
  id: z.number().int(),
  state: z.string(),
  body: z.string().nullish(),
  user: z.object({ login: z.string() }).nullish(),
  author_association: z.string().nullish(),
});

export interface GhReview {
  id: number;
  /** APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED or PENDING. */
  state: string;
  body: string;
  author: string;
  /** How the author relates to the repository: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, ... */
  association: string;
}

/** Every review of the pull request, oldest first. */
export const listPullRequestReviews = async (
  runGh: RunGh,
  repoPath: string,
  pullRequestNumber: number,
): Promise<GhRead<GhReview[]>> => {
  const items = await readPages(runGh, repoPath, `pulls/${pullRequestNumber}/reviews`);
  if (!items.ok) return items;
  const reviews = items.value.flatMap((item) => {
    const parsed = ReviewSchema.safeParse(item);
    if (!parsed.success) return [];
    const { id, state, body, user, author_association } = parsed.data;
    return [
      {
        id,
        state,
        body: body ?? "",
        author: user?.login ?? "someone",
        association: author_association ?? "NONE",
      },
    ];
  });
  return { ok: true, value: reviews.sort((a, b) => a.id - b.id) };
};

const CommentSchema = z.object({
  id: z.number().int(),
  pull_request_review_id: z.number().int().nullish(),
  path: z.string().default(""),
  line: z.number().int().nullish(),
  original_line: z.number().int().nullish(),
  body: z.string().default(""),
  user: z.object({ login: z.string() }).nullish(),
});

export interface GhReviewComment {
  id: number;
  /** The review this comment was made in, or null for one written outside a review. */
  reviewId: number | null;
  path: string;
  line: number | null;
  body: string;
  author: string;
}

/** Every line comment of the pull request's reviews, oldest first. */
export const listReviewComments = async (
  runGh: RunGh,
  repoPath: string,
  pullRequestNumber: number,
): Promise<GhRead<GhReviewComment[]>> => {
  const items = await readPages(runGh, repoPath, `pulls/${pullRequestNumber}/comments`);
  if (!items.ok) return items;
  const comments = items.value.flatMap((item) => {
    const parsed = CommentSchema.safeParse(item);
    if (!parsed.success) return [];
    const { id, pull_request_review_id, path, line, original_line, body, user } = parsed.data;
    return [
      {
        id,
        reviewId: pull_request_review_id ?? null,
        path,
        line: line ?? original_line ?? null,
        body,
        author: user?.login ?? "someone",
      },
    ];
  });
  return { ok: true, value: comments.sort((a, b) => a.id - b.id) };
};

// `{owner}` and `{repo}` are filled in by gh from the repository's remote, so the call needs no
// repository name from us.
const readPages = async (
  runGh: RunGh,
  repoPath: string,
  endpoint: string,
): Promise<GhRead<unknown[]>> => {
  const output = await readGhOutput(
    runGh,
    ["api", `repos/{owner}/{repo}/${endpoint}?per_page=100`, "--paginate"],
    repoPath,
  );
  if (!output.ok) return output;
  const items = parseJsonPages(output.value);
  return items ? { ok: true, value: items } : ghFailure("GitHub CLI returned malformed JSON");
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
};
