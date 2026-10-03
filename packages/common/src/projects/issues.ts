import { z } from "zod";
import { IdSchema, TimestampSchema } from "./primitives.ts";

/**
 * The issues of a project's repositories, as the Issues tab shows them: GitHub issues of every
 * attached repository (read with the host's `gh`) and, when the host owner connected them, the
 * issues of a Linear team or project and of Jira projects or a JQL filter. Paired devices read
 * them through the host; the Linear key and the Jira token never leave it.
 */
export const IssueSourceSchema = z.enum(["github", "linear", "jira"]);
export type IssueSource = z.infer<typeof IssueSourceSchema>;

/** Which issues a list asks for. Open is what the tab starts on. */
export const IssueStateFilterSchema = z.enum(["open", "closed", "all"]);
export type IssueStateFilter = z.infer<typeof IssueStateFilterSchema>;

/** The links the client renders, so a `javascript:` or `data:` url must never parse. */
const WebUrlSchema = z.url({ protocol: /^https?$/ });

export const IssuePersonSchema = z.object({
  /** The handle: a GitHub login, or a Linear display name. */
  login: z.string().min(1),
  /** The full name where the source has one apart from the handle. */
  name: z.string().nullable(),
  avatarUrl: WebUrlSchema.nullable(),
});
export type IssuePerson = z.infer<typeof IssuePersonSchema>;

export const IssueLabelSchema = z.object({
  name: z.string().min(1),
  /** Six hex digits without the `#`, or null when the source has none. */
  color: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/)
    .nullable(),
});
export type IssueLabel = z.infer<typeof IssueLabelSchema>;

/** A linked pull request's state as its chip shows it; `draft` is an open one not ready yet. */
export const LinkedPullRequestStateSchema = z.enum(["open", "draft", "merged", "closed"]);
export type LinkedPullRequestState = z.infer<typeof LinkedPullRequestStateSchema>;

/** What the head commit's checks add up to, or null when it has none. */
export const LinkedPullRequestChecksSchema = z.enum(["passing", "failing", "pending"]).nullable();
export type LinkedPullRequestChecks = z.infer<typeof LinkedPullRequestChecksSchema>;

/**
 * A pull request linked to an issue (GitHub's "Development" links, including the ones a
 * "Fixes #12" makes). `repoId` is the project's repository it is in, or null when it is in a
 * repository the project does not hold: the PR View can only open the former.
 */
export const LinkedPullRequestSchema = z.object({
  repoId: IdSchema.nullable(),
  nameWithOwner: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  url: WebUrlSchema,
  state: LinkedPullRequestStateSchema,
  checks: LinkedPullRequestChecksSchema,
});
export type LinkedPullRequest = z.infer<typeof LinkedPullRequestSchema>;

/**
 * Where an issue stands. `open` and `closed` are what the state filter reads; `stage` orders
 * groups the same way for both sources (Linear's workflow types; GitHub open issues are
 * `unstarted`, closed ones `completed` or `canceled` for "not planned"); `stateName` is the
 * name the source gives it ("In Progress", "Not planned").
 */
export const IssueStageSchema = z.enum([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
]);
export type IssueStage = z.infer<typeof IssueStageSchema>;

/**
 * How urgent an issue is, where the source has priorities (Linear, Jira): the name the source
 * gives it and the level the row's marker draws. A Jira scheme's own names map to no level.
 */
export const IssuePriorityLevelSchema = z.enum(["urgent", "high", "medium", "low", "lowest"]);
export type IssuePriorityLevel = z.infer<typeof IssuePriorityLevelSchema>;

export const IssuePrioritySchema = z.object({
  name: z.string().min(1),
  level: IssuePriorityLevelSchema.nullable(),
});
export type IssuePriority = z.infer<typeof IssuePrioritySchema>;

export const ProjectIssueSchema = z.object({
  /**
   * Unique across sources: `github:owner/name#12`, `linear:ENG-12` or `jira:ABC-12`. What
   * start-thread and the issue view take.
   */
  key: z.string().min(1),
  source: IssueSourceSchema,
  /** The project's repository a GitHub issue belongs to; null for Linear and Jira. */
  repoId: IdSchema.nullable(),
  /** `owner/name` for GitHub, the team or project name for Linear, the project for Jira. */
  container: z.string().min(1),
  /** `#12`, `ENG-12` or `ABC-12`. */
  identifier: z.string().min(1),
  title: z.string(),
  url: WebUrlSchema,
  state: z.enum(["open", "closed"]),
  stage: IssueStageSchema,
  stateName: z.string().min(1),
  /** The workflow state's colour (Linear), six hex digits without `#`. */
  stateColor: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/)
    .nullable(),
  labels: z.array(IssueLabelSchema),
  assignees: z.array(IssuePersonSchema),
  author: IssuePersonSchema.nullable(),
  /** A GitHub milestone, a Linear cycle or project milestone, or a Jira fix version. */
  milestone: z.string().nullable(),
  /** Null for GitHub, which has none, and for an issue without one. */
  priority: IssuePrioritySchema.nullable().default(null),
  /** Null when the source does not say. */
  commentCount: z.number().int().nonnegative().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  linkedPullRequests: z.array(LinkedPullRequestSchema),
});
export type ProjectIssue = z.infer<typeof ProjectIssueSchema>;

/**
 * How one source answered. `not-authenticated`: the host's `gh` is not logged in. `gh-missing`: the host has no `gh`.
 * `no-github-remote`: the repository has no GitHub `origin`. `not-configured`: no Linear or Jira
 * connection. `unauthorized`: Linear refused the stored key, or Jira the stored token (revoked or
 * expired). `error`: anything else, in `message`. A source that fails keeps the issues it served
 * last, with `stale` set.
 */
export const IssueSourceStatusSchema = z.object({
  source: IssueSourceSchema,
  /** The repository's id (GitHub), `linear` or `jira`. */
  id: z.string().min(1),
  /** `owner/name`, a Linear team or project name, the Jira site, or the repository's folder name. */
  name: z.string().min(1),
  status: z.enum([
    "ok",
    "not-authenticated",
    "gh-missing",
    "no-github-remote",
    "not-configured",
    "unauthorized",
    "error",
  ]),
  message: z.string().nullable(),
  /** Older issues are there to load (`limit` higher). */
  hasMore: z.boolean(),
  stale: z.boolean(),
  /** When the issues served were read from the source; null when none were. */
  fetchedAt: TimestampSchema.nullable(),
});
export type IssueSourceStatus = z.infer<typeof IssueSourceStatusSchema>;

/** `GET /api/projects/:id/issues`: every source's issues, newest update first. */
export const IssueListSchema = z.object({
  issues: z.array(ProjectIssueSchema),
  sources: z.array(IssueSourceStatusSchema),
});
export type IssueList = z.infer<typeof IssueListSchema>;

export const ISSUE_PAGE_SIZE = 100;
export const ISSUE_LIMIT_MAX = 1000;

/** The query of `GET /api/projects/:id/issues`. `refresh` skips the short reuse window. */
export const IssueListQuerySchema = z.object({
  state: IssueStateFilterSchema.default("open"),
  limit: z.coerce.number().int().positive().max(ISSUE_LIMIT_MAX).default(ISSUE_PAGE_SIZE),
  refresh: z
    .enum(["0", "1"])
    .default("0")
    .transform((value) => value === "1"),
});
export type IssueListQuery = z.infer<typeof IssueListQuerySchema>;

/** `POST /api/projects/:id/issues/start-thread`: the issue the coordinator starts a thread for. */
export const StartThreadFromIssueInputSchema = z.object({ key: z.string().min(1).max(500) });
export type StartThreadFromIssueInput = z.infer<typeof StartThreadFromIssueInputSchema>;

/** What a project's Linear issues come from: one team, or one project. */
export const LinearScopeSchema = z.object({
  kind: z.enum(["team", "project"]),
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
});
export type LinearScope = z.infer<typeof LinearScopeSchema>;

/**
 * A project's Linear connection as any client sees it: whether there is one and what it maps
 * to. The key itself is never sent; only the host owner can set or remove it.
 */
export const LinearConnectionSchema = z.object({
  configured: z.boolean(),
  scope: LinearScopeSchema.nullable(),
  /** The Linear workspace and user the key belongs to, as Linear named them when it was saved. */
  workspace: z.string().nullable(),
  viewer: z.string().nullable(),
});
export type LinearConnection = z.infer<typeof LinearConnectionSchema>;

/**
 * `PUT /api/projects/:id/linear` (host owner only). Without `apiKey` it keeps the stored key
 * and only changes the mapping.
 */
export const LinearConnectInputSchema = z.object({
  apiKey: z.string().trim().min(1).max(500).optional(),
  scope: LinearScopeSchema,
});
export type LinearConnectInput = z.infer<typeof LinearConnectInputSchema>;

/** `POST /api/projects/:id/linear/catalog` (host owner only): what a key can see, to map it. */
export const LinearCatalogInputSchema = z.object({
  apiKey: z.string().trim().min(1).max(500).optional(),
});
export type LinearCatalogInput = z.infer<typeof LinearCatalogInputSchema>;

export const LinearCatalogSchema = z.object({
  workspace: z.string(),
  viewer: z.string(),
  teams: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })),
  projects: z.array(z.object({ id: z.string(), name: z.string(), teams: z.array(z.string()) })),
});
export type LinearCatalog = z.infer<typeof LinearCatalogSchema>;
