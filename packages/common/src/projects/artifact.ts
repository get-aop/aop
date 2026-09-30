import { z } from "zod";

const PullRequestStateSchema = z.enum(["open", "merged", "closed"]);
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

/**
 * What a pull request's checks add up to, as the watcher last read them: `pending` while any check
 * still runs, else `failure` when one failed, else `success`.
 */
export const PullRequestChecksSchema = z.object({
  state: z.enum(["pending", "success", "failure"]),
  successful: z.number().int().nonnegative(),
  failing: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});
export type PullRequestChecks = z.infer<typeof PullRequestChecksSchema>;

/** A pull request as the UI shows it: the chip is "#number", coloured by state. */
export const PullRequestRefSchema = z.object({
  number: z.number().int().positive(),
  // The client renders this as a link, so a `javascript:` or `data:` url must never parse.
  url: z.url({ protocol: /^https?$/ }),
  state: PullRequestStateSchema,
  /** Absent until the pull request watcher has read the checks, and for a repository that has none. */
  checks: PullRequestChecksSchema.optional(),
});
export type PullRequestRef = z.infer<typeof PullRequestRefSchema>;

/**
 * Something a thread produced. Held as items, not counts: the Overview count pill is
 * `artifacts.filter(type).length` and its PR chip reads the `pr` item, so nothing is stored twice.
 */
export const ArtifactSchema = z.discriminatedUnion("type", [
  PullRequestRefSchema.extend({ type: z.literal("pr") }),
  z.object({ type: z.literal("doc"), name: z.string().trim().min(1).max(200) }),
]);
export type Artifact = z.infer<typeof ArtifactSchema>;
