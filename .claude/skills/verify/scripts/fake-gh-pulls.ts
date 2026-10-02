/**
 * What the fake GitHub CLI answers for the Pull requests tab (see features/pull-requests.md):
 *
 * - `gh api user --jq .login`: the signed-in account (`octocat`), or the signed-out error.
 * - `gh api graphql -f query=... -f owner=.. -f name=.. -f states[]=.. -F first=.. [-f after=..]`:
 *   one page of a repository's pull requests in the shape `PULL_REQUESTS_QUERY` asks for.
 * - `gh api -i repos/<o>/<r>/pulls?...` [-H "If-None-Match: <etag>"]: the ETag probe, 304 while
 *   nothing of that repository changed.
 *
 * Scripted from a shell with `gh fake ...`:
 *   gh fake seed-pulls [owner/name] [count]  a mixed set of pull requests (states, drafts, labels,
 *                                            authors, assignees, reviews, checks, comments)
 *   gh fake auth signed-in|signed-out        whether `gh` is signed in
 *   gh fake graphql-fail [message|off]       GraphQL reads fail with that message (a rate limit)
 *   gh fake touch <owner/name> <n> [title]   an edit on GitHub: new updatedAt (and title)
 *
 * A pull request a thread opens with `gh pr create` is listed too (as acme/widget), with the
 * checks and reviews the other controls script for it.
 */

export interface ListedFields {
  repo?: string;
  author?: string;
  labels?: { name: string; color: string }[];
  assignees?: string[];
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  requested?: string[];
  commentCount?: number;
  createdAt?: string;
  updatedAt?: string;
  checkCounts?: { SUCCESS?: number; FAILURE?: number; IN_PROGRESS?: number } | null;
}

/** The fields of a pull request the list reads; the fake's own record type extends this. */
export interface ListablePull extends ListedFields {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
  base: string;
  draft: boolean;
  checks?: { outcome: "pending" | "pass" | "fail"; names: string[] };
  reviews?: { state: string; user: { login: string } }[];
}

export interface PullsState {
  signedOut?: boolean;
  graphqlFailure?: string | null;
}

export const DEFAULT_REPO = "acme/widget";
const LOGIN = "octocat";

type Out = { stdout: string; exitCode: number; stderr?: string };

/** `gh api ...` for the list, or null when the call is not one of the list's. */
export const listApi = (
  args: string[],
  pulls: readonly ListablePull[],
  state: PullsState,
): Out | null => {
  const isList = args[1] === "user" || args[1] === "graphql" || args[1] === "-i";
  if (!isList) return null;
  if (state.signedOut) {
    return {
      stdout: "",
      exitCode: 4,
      stderr: "To get started with GitHub CLI, please run:  gh auth login",
    };
  }
  if (args[1] === "user") return { stdout: `${LOGIN}\n`, exitCode: 0 };
  if (args[1] === "graphql") return graphql(args, pulls, state);
  return probe(args, pulls);
};

const variable = (args: string[], name: string): string[] =>
  args.flatMap((arg) => (arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []));

const repoOf = (pull: ListablePull) => pull.repo ?? DEFAULT_REPO;

const graphql = (args: string[], pulls: readonly ListablePull[], state: PullsState): Out => {
  if (state.graphqlFailure) {
    return { stdout: "", exitCode: 1, stderr: `gh: ${state.graphqlFailure}` };
  }
  const repo = `${variable(args, "owner")[0]}/${variable(args, "name")[0]}`;
  const states = variable(args, "states[]");
  const first = Number(variable(args, "first")[0] ?? 100);
  const after = Number(variable(args, "after")[0] ?? 0);
  const matching = pulls
    .filter((pull) => repoOf(pull) === repo && states.includes(pull.state))
    .sort((a, b) => Date.parse(updatedAt(b)) - Date.parse(updatedAt(a)));
  const page = matching.slice(after, after + first);
  const hasNextPage = after + first < matching.length;
  const data = {
    viewer: { login: LOGIN },
    repository:
      pulls.some((pull) => repoOf(pull) === repo) || repo === DEFAULT_REPO
        ? {
            pullRequests: {
              pageInfo: { hasNextPage, endCursor: hasNextPage ? String(after + first) : null },
              nodes: page.map(toNode),
            },
          }
        : null,
  };
  return { stdout: JSON.stringify({ data }), exitCode: 0 };
};

const probe = (args: string[], pulls: readonly ListablePull[]): Out => {
  const path = args[2] ?? "";
  const repo = /^repos\/([^/]+\/[^/]+)\/pulls/.exec(path)?.[1] ?? "";
  const etag = `W/"${hash(JSON.stringify(pulls.filter((pull) => repoOf(pull) === repo)))}"`;
  const sent = args.includes("-H") ? args[args.indexOf("-H") + 1] : null;
  if (sent === `If-None-Match: ${etag}`) {
    return { stdout: `HTTP/2.0 304 Not Modified\r\nEtag: ${etag}\r\n\r\n`, exitCode: 1 };
  }
  return { stdout: `HTTP/2.0 200 OK\r\nEtag: ${etag}\r\n\r\n[]`, exitCode: 0 };
};

const updatedAt = (pull: ListablePull) => pull.updatedAt ?? "2026-10-01T09:00:00Z";

const user = (login: string) => ({
  login,
  avatarUrl: `https://avatars.githubusercontent.com/${login}`,
});

const toNode = (pull: ListablePull) => ({
  number: pull.number,
  title: pull.title,
  url: pull.url,
  state: pull.state,
  isDraft: pull.draft,
  createdAt: pull.createdAt ?? "2026-09-30T09:00:00Z",
  updatedAt: updatedAt(pull),
  headRefName: pull.head,
  baseRefName: pull.base,
  author: user(pull.author ?? LOGIN),
  labels: { nodes: pull.labels ?? [] },
  assignees: { nodes: (pull.assignees ?? []).map(user) },
  reviewDecision: pull.reviewDecision ?? reviewDecisionOf(pull),
  reviewRequests: {
    nodes: (pull.requested ?? []).map((login) => ({ requestedReviewer: { login } })),
  },
  latestOpinionatedReviews: {
    nodes: (pull.reviews ?? []).map((review) => ({ author: { login: review.user.login } })),
  },
  comments: { totalCount: pull.commentCount ?? 0 },
  commits: { nodes: [{ commit: { statusCheckRollup: rollupOf(pull) } }] },
});

const reviewDecisionOf = (pull: ListablePull) => {
  const last = pull.reviews?.at(-1)?.state;
  if (last === "APPROVED") return "APPROVED";
  if (last === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  return null;
};

const rollupOf = (pull: ListablePull) => {
  const counts = pull.checkCounts ?? countsOfRound(pull);
  if (!counts) return null;
  const state = counts.FAILURE ? "FAILURE" : counts.IN_PROGRESS ? "PENDING" : "SUCCESS";
  return {
    state,
    contexts: {
      checkRunCountsByState: Object.entries(counts).map(([name, count]) => ({
        state: name,
        count,
      })),
      statusContextCountsByState: [],
    },
  };
};

const countsOfRound = (pull: ListablePull): ListedFields["checkCounts"] => {
  if (!pull.checks) return null;
  const n = pull.checks.names.length;
  if (pull.checks.outcome === "pass") return { SUCCESS: n };
  if (pull.checks.outcome === "fail") return { FAILURE: n };
  return { IN_PROGRESS: n };
};

const hash = (text: string): string => {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) | 0;
  }
  return (value >>> 0).toString(16);
};

const LABELS = {
  bug: { name: "bug", color: "d73a4a" },
  feature: { name: "feature", color: "a2eeef" },
  docs: { name: "documentation", color: "0075ca" },
  ui: { name: "ui", color: "7057ff" },
  perf: { name: "performance", color: "fbca04" },
  deps: { name: "dependencies", color: "0366d6" },
};

const TITLES = [
  "Fix checkout total rounding for multi-currency carts",
  "Add dark mode to the settings page",
  "Bump bun from 1.3.13 to 1.3.14",
  "Speed up product search with a trigram index",
  "Document the webhook retry policy",
  "Refactor the payment adapter behind an interface",
  "Show the order history on the account page",
  "Drop the legacy v1 cart API",
  "Cache avatars on the CDN",
  "Fix flaky inventory sync test",
  "Translate the onboarding flow to Portuguese",
  "Add rate limiting to the public API",
];
const AUTHORS = ["octocat", "hubot", "monalisa", "dependabot[bot]", "mona-dev"];

/**
 * A mixed set of pull requests for `repo`: every state, drafts, labels, several authors and
 * assignees, each review decision and checks outcome, comments, spread over the last weeks.
 */
export const seedPulls = (
  repo: string,
  count: number,
  firstNumber: number,
  now: number,
): ListablePull[] =>
  Array.from({ length: count }, (_, index) => seedPull(repo, firstNumber + index, index, now));

const STATES = ["OPEN", "OPEN", "OPEN", "MERGED", "CLOSED", "OPEN", "MERGED"] as const;
const LABEL_SETS = [
  [LABELS.bug],
  [LABELS.feature, LABELS.ui],
  [LABELS.deps],
  [LABELS.perf],
  [LABELS.docs],
  [],
  [LABELS.bug, LABELS.perf],
];
const DECISIONS = ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", null] as const;
const CHECKS = [{ SUCCESS: 6 }, { SUCCESS: 4, FAILURE: 2 }, { SUCCESS: 3, IN_PROGRESS: 2 }, null];
const ASSIGNEES = [[LOGIN], ["monalisa", "hubot"], []];

/** The item of `list` for the `index`-th pull request, going round. */
const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

const seedPull = (repo: string, number: number, index: number, now: number): ListablePull => {
  const state = pick(STATES, index);
  const title = pick(TITLES, index);
  const author = pick(AUTHORS, index);
  const round = Math.floor(index / TITLES.length);
  return {
    repo,
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    title: round > 0 ? `${title} (part ${round + 1})` : title,
    state,
    head: `${author.replace(/\W/g, "")}/${title.toLowerCase().split(" ").slice(0, 3).join("-")}-${number}`,
    base: "main",
    draft: state === "OPEN" && index % 5 === 1,
    author,
    labels: pick(LABEL_SETS, index),
    assignees: pick(ASSIGNEES, index),
    reviewDecision: pick(DECISIONS, index),
    requested: index % 4 === 2 ? [LOGIN] : [],
    commentCount: (index * 7) % 13,
    createdAt: new Date(now - (index + 3) * 36 * 3_600_000).toISOString(),
    updatedAt: new Date(now - index * 5 * 3_600_000 - 20 * 60_000).toISOString(),
    checkCounts: pick(CHECKS, index),
  };
};
