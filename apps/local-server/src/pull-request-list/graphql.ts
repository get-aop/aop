import { z } from "zod";

/*
 * One GraphQL read per page of a repository's pull requests, newest update first, with what a
 * row of the list shows (labels, assignees, review decision, the head commit's checks) and what
 * "involves me" needs (requested reviewers, reviewers). A page costs one point of GitHub's
 * GraphQL rate limit.
 */

export const PULL_REQUESTS_QUERY = `query($owner: String!, $name: String!, $states: [PullRequestState!], $first: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(states: $states, first: $first, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url state isDraft createdAt updatedAt
        headRefName baseRefName
        author { login avatarUrl }
        labels(first: 20) { nodes { name color } }
        assignees(first: 10) { nodes { login avatarUrl } }
        reviewDecision
        reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } }
        latestOpinionatedReviews(first: 10) { nodes { author { login } } }
        comments { totalCount }
        commits(last: 1) { nodes { commit { statusCheckRollup {
          state
          contexts {
            checkRunCountsByState { state count }
            statusContextCountsByState { state count }
          }
        } } } }
      }
    }
  }
}`;

const nodes = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({ nodes: z.array(item.nullable()).nullish() })
    .nullish()
    .transform((connection) =>
      (connection?.nodes ?? []).filter((node): node is z.infer<T> & {} => node != null),
    );

const LoginSchema = z.object({ login: z.string() });
const UserSchema = z.object({ login: z.string(), avatarUrl: z.string().nullish() });
const CountsSchema = z.array(z.object({ state: z.string(), count: z.number() })).nullish();

export const GraphqlPullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  headRefName: z.string().default(""),
  baseRefName: z.string().default(""),
  author: UserSchema.nullish(),
  labels: nodes(z.object({ name: z.string(), color: z.string() })),
  assignees: nodes(UserSchema),
  reviewDecision: z.string().nullish(),
  reviewRequests: nodes(z.object({ requestedReviewer: LoginSchema.partial().nullish() })),
  latestOpinionatedReviews: nodes(z.object({ author: LoginSchema.nullish() })),
  comments: z.object({ totalCount: z.number().int() }).nullish(),
  commits: nodes(
    z.object({
      commit: z.object({
        statusCheckRollup: z
          .object({
            state: z.string(),
            contexts: z
              .object({
                checkRunCountsByState: CountsSchema,
                statusContextCountsByState: CountsSchema,
              })
              .nullish(),
          })
          .nullish(),
      }),
    }),
  ),
});
export type GraphqlPullRequest = z.infer<typeof GraphqlPullRequestSchema>;

export const PullRequestsPageSchema = z.object({
  viewer: LoginSchema,
  repository: z
    .object({
      pullRequests: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() }),
        nodes: z.array(GraphqlPullRequestSchema.nullable()),
      }),
    })
    .nullable(),
});
export type PullRequestsPage = z.infer<typeof PullRequestsPageSchema>;
