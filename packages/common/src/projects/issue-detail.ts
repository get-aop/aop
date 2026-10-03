import { z } from "zod";
import { IssuePersonSchema, ProjectIssueSchema } from "./issues.ts";
import { TimestampSchema } from "./primitives.ts";

/**
 * One issue read whole, for the issue view: what the list shows of it, its description and its
 * comments, all as Markdown (Jira's Atlassian Document Format is converted on the host). The
 * client renders the Markdown with raw HTML shown as text, so nothing in an issue runs.
 */
export const IssueCommentSchema = z.object({
  id: z.string().min(1),
  author: IssuePersonSchema.nullable(),
  body: z.string(),
  createdAt: TimestampSchema,
});
export type IssueComment = z.infer<typeof IssueCommentSchema>;

/** A part of an issue beside its description that a thread needs, e.g. Jira's acceptance criteria. */
export const IssueSectionSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
});
export type IssueSection = z.infer<typeof IssueSectionSchema>;

export const IssueDetailSchema = z.object({
  issue: ProjectIssueSchema,
  /** The description as Markdown; empty when the issue has none. */
  body: z.string(),
  sections: z.array(IssueSectionSchema),
  /** The latest comments, oldest first. */
  comments: z.array(IssueCommentSchema),
  /** How many comments the issue has; more than `comments` holds when it has many. */
  commentCount: z.number().int().nonnegative(),
});
export type IssueDetail = z.infer<typeof IssueDetailSchema>;

/** `GET /api/projects/:id/issues/detail?key=`: the issue whose list key this is. */
export const IssueDetailQuerySchema = z.object({ key: z.string().min(1).max(500) });
