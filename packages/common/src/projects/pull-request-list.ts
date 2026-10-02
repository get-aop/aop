import { z } from "zod";
import { PullRequestChecksSchema } from "./artifact.ts";
import { GithubLabelSchema, GithubProjectRepoSchema, GithubUserSchema } from "./github.ts";
import { IdSchema, TimestampSchema } from "./primitives.ts";

/*
 * The project's pull requests across its GitHub repositories, as the Pull requests tab lists
 * them: `GET /api/projects/:projectId/github/pulls`.
 */

export const PULL_REQUEST_LIST_STATES = ["open", "closed", "merged", "all"] as const;
export type PullRequestListState = (typeof PULL_REQUEST_LIST_STATES)[number];

export const PULL_REQUEST_LIST_SORTS = [
  "updated",
  "least-updated",
  "newest",
  "oldest",
  "most-commented",
  "least-commented",
] as const;
export type PullRequestListSort = (typeof PULL_REQUEST_LIST_SORTS)[number];

export const PULL_REQUEST_LIST_MAX_LIMIT = 100;

/**
 * What narrows the list. Authors and assignees match any of those chosen; labels match all of
 * them, as on GitHub. `q` matches the title, the number, the branch, the author and the repo.
 */
export const PullRequestListQuerySchema = z.object({
  state: z.enum(PULL_REQUEST_LIST_STATES).default("open"),
  author: z.array(z.string().min(1).max(100)).max(50).default([]),
  label: z.array(z.string().min(1).max(100)).max(50).default([]),
  assignee: z.array(z.string().min(1).max(100)).max(50).default([]),
  q: z.string().trim().max(200).default(""),
  sort: z.enum(PULL_REQUEST_LIST_SORTS).default("updated"),
  /** Only pull requests the host's GitHub account wrote, is assigned, or reviews. */
  involves: z.boolean().default(false),
  /** Where the page starts, from the last page's `nextCursor`. */
  cursor: z.string().max(20).optional(),
  limit: z.number().int().min(1).max(PULL_REQUEST_LIST_MAX_LIMIT).default(50),
  /** Read GitHub again instead of answering from the last few seconds' read. */
  refresh: z.boolean().default(false),
});
export type PullRequestListQuery = z.infer<typeof PullRequestListQuerySchema>;
export type PullRequestListQueryInput = z.input<typeof PullRequestListQuerySchema>;

/** Open, draft (open and not ready for review), merged, or closed without merging. */
export const PullRequestListItemStateSchema = z.enum(["open", "draft", "merged", "closed"]);
export type PullRequestListItemState = z.infer<typeof PullRequestListItemStateSchema>;

/** GitHub's review decision: null when the repository requires no review. */
export const PullRequestReviewStateSchema = z.enum([
  "approved",
  "changes-requested",
  "review-required",
]);
export type PullRequestReviewState = z.infer<typeof PullRequestReviewStateSchema>;

export const PullRequestListItemSchema = z.object({
  repoId: IdSchema,
  /** `owner/name` of the repository on GitHub. */
  repo: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url({ protocol: /^https?$/ }),
  state: PullRequestListItemStateSchema,
  author: GithubUserSchema.nullable(),
  labels: z.array(GithubLabelSchema),
  assignees: z.array(GithubUserSchema),
  review: PullRequestReviewStateSchema.nullable(),
  /** The head commit's checks; null when it has none. */
  checks: PullRequestChecksSchema.nullable(),
  headRefName: z.string(),
  baseRefName: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  comments: z.number().int().nonnegative(),
  /** The AOP thread whose pull request this is, if any. */
  threadId: IdSchema.nullable(),
});
export type PullRequestListItem = z.infer<typeof PullRequestListItemSchema>;

/** How often a value of a filter appears among the pull requests of the chosen state. */
export const PullRequestFacetSchema = z.object({
  value: z.string().min(1),
  count: z.number().int().positive(),
  avatarUrl: z.string().nullable(),
  /** A label's colour (six hex digits); null for a person. */
  color: z.string().nullable(),
});
export type PullRequestFacet = z.infer<typeof PullRequestFacetSchema>;

export const PullRequestListRepoSchema = GithubProjectRepoSchema.extend({
  /** Why its pull requests could not be read now; the list shows the last good read, if any. */
  error: z.string().nullable(),
  /** It has more pull requests of this state than the host reads: the oldest are left out. */
  truncated: z.boolean(),
});
export type PullRequestListRepo = z.infer<typeof PullRequestListRepoSchema>;

export const PullRequestListUnavailableReasonSchema = z.enum([
  "no-repos",
  "no-github-repos",
  "gh-missing",
  "signed-out",
  "unreachable",
]);
export type PullRequestListUnavailableReason = z.infer<
  typeof PullRequestListUnavailableReasonSchema
>;

export const PullRequestListResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    viewerLogin: z.string(),
    repos: z.array(PullRequestListRepoSchema),
    items: z.array(PullRequestListItemSchema),
    /** How many match the filters, over every page. */
    total: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
    facets: z.object({
      authors: z.array(PullRequestFacetSchema),
      labels: z.array(PullRequestFacetSchema),
      assignees: z.array(PullRequestFacetSchema),
    }),
    /** When the oldest of the reads this answer is made of came from GitHub. */
    fetchedAt: TimestampSchema,
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: PullRequestListUnavailableReasonSchema,
    message: z.string(),
    repos: z.array(GithubProjectRepoSchema),
  }),
]);
export type PullRequestListResponse = z.infer<typeof PullRequestListResponseSchema>;
