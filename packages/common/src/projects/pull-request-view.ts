import { z } from "zod";
import type { GithubLabel, GithubUser } from "./github.ts";

/*
 * One pull request as the PR View shows it, GitHub's page in AOP: what the host reads through its
 * own `gh` session and what it lets the host owner do. The host builds every field; the dashboard
 * only renders them, so these are plain types, and only the write bodies are schemas.
 */

export type PullRequestViewState = "open" | "closed" | "merged";

/** A check of the head commit: an Actions job, another app's check run, or a commit status. */
export interface PullRequestViewCheck {
  name: string;
  /** The workflow (or app) it belongs to, shown before the name as GitHub does: "build / test". */
  workflow: string | null;
  status: "queued" | "in_progress" | "success" | "failure" | "neutral" | "skipped" | "cancelled";
  /** Whether the base branch's rules require it to pass before a merge. */
  required: boolean;
  /** The check's page, which holds its logs. */
  url: string | null;
  description: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** What the checks add up to, as the header and the merge box say it. */
export interface PullRequestViewChecks {
  /** `none`: the head commit has no checks at all. */
  state: "none" | "pending" | "success" | "failure";
  total: number;
  successful: number;
  failing: number;
  pending: number;
  skipped: number;
  items: PullRequestViewCheck[];
}

export interface PullRequestViewReviewer {
  login: string;
  avatarUrl: string | null;
  /** A team asked for review is named, not logged in. */
  isTeam: boolean;
  /** `requested`: asked and not yet answered (or asked again after answering). */
  state: "requested" | "approved" | "changes_requested" | "commented" | "dismissed";
}

export interface PullRequestViewCommit {
  sha: string;
  shortSha: string;
  headline: string;
  url: string;
  committedAt: string;
  authors: GithubUser[];
  /** What the checks of this commit added up to; null when it had none. */
  checks: "pending" | "success" | "failure" | null;
}

export interface PullRequestViewComment {
  id: string;
  author: GithubUser | null;
  body: string;
  createdAt: string;
  url: string | null;
}

/** A conversation on a line of the diff. */
export interface PullRequestViewReviewThread {
  id: string;
  path: string;
  /** The line in the new file it is on; null once the line is gone (outdated). */
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  diffHunk: string | null;
  comments: PullRequestViewComment[];
}

/** One entry of the Conversation tab's timeline, oldest first. */
export type PullRequestViewTimelineItem =
  | ({ kind: "comment" } & PullRequestViewComment)
  | ({
      kind: "review";
      state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
    } & PullRequestViewComment)
  | { kind: "commits"; at: string; commits: PullRequestViewCommit[] }
  | {
      kind: "event";
      at: string;
      actor: string | null;
      event:
        | "labeled"
        | "unlabeled"
        | "closed"
        | "reopened"
        | "merged"
        | "ready_for_review"
        | "converted_to_draft"
        | "force_pushed"
        | "review_requested"
        | "assigned"
        | "renamed"
        | "referenced"
        | "base_changed"
        | "head_deleted"
        | "auto_merge_enabled";
      /** What the event names: a label, a reviewer, the old and new title, a commit, a reference. */
      label?: GithubLabel;
      subject?: string;
      url?: string;
    };

export type PullRequestMergeMethod = "squash" | "merge" | "rebase";

/** One reason a merge cannot happen now, in the words GitHub's merge box uses. */
export interface PullRequestMergeBlocker {
  kind:
    | "draft"
    | "conflicts"
    | "behind"
    | "review_required"
    | "changes_requested"
    | "checks_failing"
    | "checks_pending"
    | "checks_missing"
    | "unresolved_threads"
    | "rules"
    | "computing"
    | "not_allowed";
  title: string;
  detail: string | null;
}

/** GitHub's merge box: can this merge, how, and if not, why not. */
export interface PullRequestViewMergeBox {
  /** `ready`: nothing stands in the way; `blocked`: see `blockers`; `done`: merged or closed. */
  status: "ready" | "blocked" | "done";
  blockers: PullRequestMergeBlocker[];
  /** Checks that failed or still run but are not required: the merge can go ahead regardless. */
  warnings: string[];
  conflicts: "none" | "conflicting" | "unknown";
  /** The methods both the repository's settings and the base branch's rules allow. */
  methods: PullRequestMergeMethod[];
  /** Required check names the rules ask for that the head commit never reported. */
  missingRequiredChecks: string[];
}

/** What this client may do, decided by the host: devices read, the host owner may also write. */
export interface PullRequestViewViewer {
  /** The host owner, through the host's `gh` login with write access to the repository. */
  canWrite: boolean;
  /** Why `canWrite` is false, in a sentence the page can show. */
  readOnlyReason: string | null;
  /** The `gh` login the host acts as. */
  login: string | null;
}

/** `GET /api/projects/:projectId/github/repos/:repoId/pulls/:number`. */
export interface PullRequestViewDetail {
  repoId: string;
  nameWithOwner: string;
  number: number;
  title: string;
  url: string;
  state: PullRequestViewState;
  isDraft: boolean;
  body: string;
  author: GithubUser | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  baseRefName: string;
  headRefName: string;
  /** `owner:branch` when the head is in a fork, as GitHub writes it. */
  headLabel: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commitCount: number;
  commentCount: number;
  labels: GithubLabel[];
  assignees: GithubUser[];
  milestone: { title: string; url: string; dueOn: string | null } | null;
  reviewers: PullRequestViewReviewer[];
  linkedIssues: { number: number; title: string; url: string; state: "open" | "closed" }[];
  checks: PullRequestViewChecks;
  commits: PullRequestViewCommit[];
  timeline: PullRequestViewTimelineItem[];
  /** How many older timeline entries GitHub holds beyond the latest ones read. */
  timelineOmitted: number;
  reviewThreads: PullRequestViewReviewThread[];
  merge: PullRequestViewMergeBox;
  viewer: PullRequestViewViewer;
  /** When the host read it from GitHub. */
  fetchedAt: string;
}

/** `GET .../pulls/:number/checks`: the part the page polls while checks run. */
export interface PullRequestViewChecksResponse {
  state: PullRequestViewState;
  headSha: string;
  checks: PullRequestViewChecks;
  merge: PullRequestViewMergeBox;
  fetchedAt: string;
}

/** A changed file, with its patch in unified diff form. */
export interface PullRequestViewFile {
  path: string;
  previousPath: string | null;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** The file's hunks; null when GitHub does not send one (binary, or too large to diff). */
  patch: string | null;
}

/** `GET .../pulls/:number/files`. */
export interface PullRequestViewFilesResponse {
  files: PullRequestViewFile[];
  /** GitHub lists at most 3000 files of a pull request. */
  truncated: boolean;
}

export const PullRequestCommentBodySchema = z.object({
  body: z.string().trim().min(1, "Write a comment first").max(65_536),
});

export const PullRequestReviewBodySchema = z.object({
  event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
  body: z.string().max(65_536).default(""),
});

export const PullRequestMergeBodySchema = z.object({
  method: z.enum(["squash", "merge", "rebase"]),
  /** The head the person saw; GitHub refuses the merge if the branch moved since. */
  expectedHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
  title: z.string().max(256).optional(),
  message: z.string().max(65_536).optional(),
});

export const PullRequestUpdateBodySchema = z
  .object({
    title: z.string().trim().min(1, "A title cannot be empty").max(256).optional(),
    state: z.enum(["open", "closed"]).optional(),
    draft: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Say what to change: title, state or draft",
  });

export type PullRequestCommentBody = z.infer<typeof PullRequestCommentBodySchema>;
export type PullRequestReviewBody = z.input<typeof PullRequestReviewBodySchema>;
export type PullRequestMergeBody = z.infer<typeof PullRequestMergeBodySchema>;
export type PullRequestUpdateBody = z.infer<typeof PullRequestUpdateBodySchema>;
