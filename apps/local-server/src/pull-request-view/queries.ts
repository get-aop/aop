import { z } from "zod";

/*
 * The two GraphQL reads of a pull request: the whole page in one round trip, and the part the
 * page polls while checks run. Both share the head commit's checks and the merge state, so the
 * merge box is computed the same way from either. The schemas check only what the mappers read;
 * GitHub may add fields.
 */

const HEAD_FIELDS = `
  number title url state isDraft headRefOid baseRefName
  mergeable mergeStateStatus reviewDecision
  headCommit: commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 100) { nodes {
    __typename
    ... on CheckRun { name status conclusion detailsUrl startedAt completedAt isRequired(pullRequestNumber: $number)
      checkSuite { workflowRun { workflow { name } } app { name } } }
    ... on StatusContext { context state targetUrl description createdAt isRequired(pullRequestNumber: $number) }
  } } } } } }`;

const REPO_FIELDS = "viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed";

const ACTOR = "author { login avatarUrl }";
const COMMIT_FIELDS = `oid abbreviatedOid messageHeadline committedDate url
  authors(first: 3) { nodes { name user { login avatarUrl } } } statusCheckRollup { state }`;

const TIMELINE_TYPES = [
  "ISSUE_COMMENT",
  "PULL_REQUEST_REVIEW",
  "PULL_REQUEST_COMMIT",
  "LABELED_EVENT",
  "UNLABELED_EVENT",
  "CLOSED_EVENT",
  "REOPENED_EVENT",
  "MERGED_EVENT",
  "READY_FOR_REVIEW_EVENT",
  "CONVERT_TO_DRAFT_EVENT",
  "HEAD_REF_FORCE_PUSHED_EVENT",
  "REVIEW_REQUESTED_EVENT",
  "ASSIGNED_EVENT",
  "RENAMED_TITLE_EVENT",
  "CROSS_REFERENCED_EVENT",
  "BASE_REF_CHANGED_EVENT",
  "HEAD_REF_DELETED_EVENT",
  "AUTO_MERGE_ENABLED_EVENT",
].join(", ");

const TIMELINE_FIELDS = `
  __typename
  ... on IssueComment { id url body createdAt ${ACTOR} }
  ... on PullRequestReview { id url state body submittedAt createdAt ${ACTOR} }
  ... on PullRequestCommit { commit { ${COMMIT_FIELDS} } }
  ... on LabeledEvent { createdAt actor { login } label { name color } }
  ... on UnlabeledEvent { createdAt actor { login } label { name color } }
  ... on ClosedEvent { createdAt actor { login } }
  ... on ReopenedEvent { createdAt actor { login } }
  ... on MergedEvent { createdAt actor { login } commit { abbreviatedOid } }
  ... on ReadyForReviewEvent { createdAt actor { login } }
  ... on ConvertToDraftEvent { createdAt actor { login } }
  ... on HeadRefForcePushedEvent { createdAt actor { login } afterCommit { abbreviatedOid } }
  ... on ReviewRequestedEvent { createdAt actor { login }
    requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } } }
  ... on AssignedEvent { createdAt actor { login } assignee { __typename ... on User { login } ... on Bot { login } } }
  ... on RenamedTitleEvent { createdAt actor { login } previousTitle currentTitle }
  ... on CrossReferencedEvent { createdAt actor { login }
    source { __typename ... on Issue { number title url } ... on PullRequest { number title url } } }
  ... on BaseRefChangedEvent { createdAt actor { login } currentRefName }
  ... on HeadRefDeletedEvent { createdAt actor { login } headRefName }
  ... on AutoMergeEnabledEvent { createdAt actor { login } }`;

/** The whole page: header, sidebar, commits, timeline, review threads and the merge state. */
export const DETAIL_QUERY = `query PullRequestView($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { ${REPO_FIELDS}
    pullRequest(number: $number) { ${HEAD_FIELDS}
      body createdAt updatedAt mergedAt closedAt ${ACTOR}
      headRefName isCrossRepository headRepositoryOwner { login }
      additions deletions changedFiles
      labels(first: 30) { nodes { name color } }
      assignees(first: 20) { nodes { login avatarUrl } }
      milestone { title url dueOn }
      reviewRequests(first: 20) { nodes { requestedReviewer { __typename
        ... on User { login avatarUrl } ... on Team { name } ... on Bot { login avatarUrl } } } }
      latestReviews(first: 30) { nodes { state ${ACTOR} } }
      closingIssuesReferences(first: 20) { nodes { number title url state } }
      comments { totalCount }
      commits(last: 100) { totalCount nodes { commit { ${COMMIT_FIELDS} } } }
      reviewThreads(first: 100) { nodes { id isResolved isOutdated path line
        comments(first: 50) { nodes { id body createdAt url diffHunk ${ACTOR} } } } }
      timelineItems(last: 100, itemTypes: [${TIMELINE_TYPES}]) { totalCount nodes { ${TIMELINE_FIELDS} } }
    }
  }
}`;

/** What the page polls while checks run: the head commit's checks and the merge state. */
export const CHECKS_QUERY = `query PullRequestChecks($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { ${REPO_FIELDS}
    pullRequest(number: $number) { ${HEAD_FIELDS} reviewThreads(first: 100) { nodes { isResolved } } }
  }
}`;

const Login = z.object({ login: z.string() }).nullable().optional();
const User = z.object({ login: z.string(), avatarUrl: z.string().nullable().optional() });
const nodes = <T extends z.ZodType>(item: T) =>
  z
    .object({ nodes: z.array(item.nullable()).nullable().optional() })
    .nullable()
    .optional();

const CheckContext = z.union([
  z.object({
    __typename: z.literal("CheckRun"),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable().optional(),
    detailsUrl: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    isRequired: z.boolean().nullable().optional(),
    checkSuite: z
      .object({
        workflowRun: z
          .object({ workflow: z.object({ name: z.string() }) })
          .nullable()
          .optional(),
        app: z.object({ name: z.string() }).nullable().optional(),
      })
      .nullable()
      .optional(),
  }),
  z.object({
    __typename: z.literal("StatusContext"),
    context: z.string(),
    state: z.string(),
    targetUrl: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    isRequired: z.boolean().nullable().optional(),
  }),
]);
export type RawCheckContext = z.infer<typeof CheckContext>;

const Commit = z.object({
  oid: z.string(),
  abbreviatedOid: z.string(),
  messageHeadline: z.string(),
  committedDate: z.string(),
  url: z.string(),
  authors: nodes(z.object({ name: z.string().nullable().optional(), user: User.nullable() })),
  statusCheckRollup: z.object({ state: z.string() }).nullable().optional(),
});
export type RawCommit = z.infer<typeof Commit>;

const Repo = {
  viewerPermission: z.string().nullable().optional(),
  mergeCommitAllowed: z.boolean(),
  squashMergeAllowed: z.boolean(),
  rebaseMergeAllowed: z.boolean(),
};

const Head = {
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  mergeable: z.string(),
  mergeStateStatus: z.string(),
  reviewDecision: z.string().nullable().optional(),
  headCommit: nodes(
    z.object({
      commit: z.object({
        oid: z.string(),
        statusCheckRollup: z
          .object({ state: z.string(), contexts: nodes(CheckContext) })
          .nullable()
          .optional(),
      }),
    }),
  ),
};

/** A timeline entry; its typename decides which of the optional fields it has. */
const TimelineNode = z
  .object({
    __typename: z.string(),
    id: z.string().optional(),
    url: z.string().nullable().optional(),
    body: z.string().optional(),
    state: z.string().optional(),
    createdAt: z.string().optional(),
    submittedAt: z.string().nullable().optional(),
    author: User.nullable().optional(),
    actor: Login,
    commit: z
      .union([Commit, z.object({ abbreviatedOid: z.string() })])
      .nullable()
      .optional(),
    label: z.object({ name: z.string(), color: z.string() }).nullable().optional(),
    afterCommit: z.object({ abbreviatedOid: z.string() }).nullable().optional(),
    requestedReviewer: z
      .object({ login: z.string().optional(), name: z.string().optional() })
      .nullable()
      .optional(),
    assignee: z.object({ login: z.string().optional() }).nullable().optional(),
    previousTitle: z.string().optional(),
    currentTitle: z.string().optional(),
    source: z
      .object({
        number: z.number().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
      })
      .nullable()
      .optional(),
    currentRefName: z.string().optional(),
    headRefName: z.string().optional(),
  })
  .passthrough();
export type RawTimelineNode = z.infer<typeof TimelineNode>;

const ReviewComment = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string().nullable().optional(),
  diffHunk: z.string().nullable().optional(),
  author: User.nullable().optional(),
});

export const DetailDataSchema = z.object({
  repository: z
    .object({
      ...Repo,
      pullRequest: z
        .object({
          ...Head,
          body: z.string(),
          createdAt: z.string(),
          updatedAt: z.string(),
          mergedAt: z.string().nullable().optional(),
          closedAt: z.string().nullable().optional(),
          author: User.nullable().optional(),
          headRefName: z.string(),
          isCrossRepository: z.boolean(),
          headRepositoryOwner: Login,
          additions: z.number(),
          deletions: z.number(),
          changedFiles: z.number(),
          labels: nodes(z.object({ name: z.string(), color: z.string() })),
          assignees: nodes(User),
          milestone: z
            .object({ title: z.string(), url: z.string(), dueOn: z.string().nullable().optional() })
            .nullable()
            .optional(),
          reviewRequests: nodes(
            z.object({
              requestedReviewer: z
                .object({
                  __typename: z.string(),
                  login: z.string().optional(),
                  name: z.string().optional(),
                  avatarUrl: z.string().nullable().optional(),
                })
                .nullable(),
            }),
          ),
          latestReviews: nodes(z.object({ state: z.string(), author: User.nullable().optional() })),
          closingIssuesReferences: nodes(
            z.object({ number: z.number(), title: z.string(), url: z.string(), state: z.string() }),
          ),
          comments: z.object({ totalCount: z.number() }),
          commits: z.object({
            totalCount: z.number(),
            nodes: z
              .array(z.object({ commit: Commit }).nullable())
              .nullable()
              .optional(),
          }),
          reviewThreads: nodes(
            z.object({
              id: z.string(),
              isResolved: z.boolean(),
              isOutdated: z.boolean(),
              path: z.string(),
              line: z.number().nullable().optional(),
              comments: nodes(ReviewComment),
            }),
          ),
          timelineItems: z.object({
            totalCount: z.number(),
            nodes: z.array(TimelineNode.nullable()).nullable().optional(),
          }),
        })
        .nullable(),
    })
    .nullable(),
});
export type DetailData = z.infer<typeof DetailDataSchema>;
export type RawPullRequest = NonNullable<NonNullable<DetailData["repository"]>["pullRequest"]>;

export const ChecksDataSchema = z.object({
  repository: z
    .object({
      ...Repo,
      pullRequest: z
        .object({
          ...Head,
          reviewThreads: nodes(z.object({ isResolved: z.boolean() })),
        })
        .nullable(),
    })
    .nullable(),
});
export type ChecksData = z.infer<typeof ChecksDataSchema>;
export type RawHead = NonNullable<NonNullable<ChecksData["repository"]>["pullRequest"]>;
export type RawRepo = Omit<NonNullable<ChecksData["repository"]>, "pullRequest">;

/** The items of a connection, without the nulls GitHub puts where it could not read one. */
export const itemsOf = <T>(connection: { nodes?: (T | null)[] | null } | null | undefined): T[] =>
  (connection?.nodes ?? []).filter((node): node is T => node !== null);
