#!/usr/bin/env bun
/**
 * A fake GitHub CLI for the PR View recipe (features/pull-request-view.md): it answers the calls
 * the host's PR View makes (`gh api user`, `gh api graphql`, `gh api -i repos/...`, the writes
 * through `gh api -X ...` and `gh pr ready`) from the fixtures in `pr-view-fixtures.ts`, never the
 * network. Writes change its state, so a comment, a review, a merge or a close shows on the page.
 *
 * State is `pr-view.json` in `$FAKE_GH_DIR` (default `$AOP_HOME/fake-gh`), every call is appended
 * to `calls.log` there. Switches, as files in that directory:
 *   signed-out    `gh api user` fails as a signed-out `gh` does
 *   rate-limited  every GraphQL read fails with GitHub's rate-limit message
 *   refuse-merge  the next merge is refused by "the rules", the way GitHub words it (one time)
 * `bun fake-gh-pr-view.ts fake reset` puts the fixtures back.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_AVATARS,
  type FixturePullRequest,
  fixturePullRequests,
} from "./pr-view-fixtures.ts";

const dir = process.env.FAKE_GH_DIR ?? join(process.env.AOP_HOME ?? ".", "fake-gh");
mkdirSync(dir, { recursive: true });
const statePath = join(dir, "pr-view.json");
const args = process.argv.slice(2);
appendFileSync(join(dir, "calls.log"), `${JSON.stringify(args)}\n`);

const VIEWER = "fixture-owner";
const REPO = "acme/fixtures";

const load = (): FixturePullRequest[] =>
  existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : fixturePullRequests();
const save = (prs: FixturePullRequest[]) => writeFileSync(statePath, JSON.stringify(prs));
const flag = (name: string) => existsSync(join(dir, name));

// Written synchronously: process.exit right after an async write to a pipe cuts it at 64 KB.
const out = (text: string, code = 0): never => {
  writeFileSync(1, text);
  process.exit(code);
};
const fail = (message: string, code = 1): never => {
  writeFileSync(2, `${message}\n`);
  process.exit(code);
};
const field = (name: string): string | undefined => {
  for (let index = 0; index < args.length; index++) {
    const value = args[index + 1] ?? "";
    if ((args[index] === "-f" || args[index] === "-F") && value.startsWith(`${name}=`)) {
      return value.slice(name.length + 1);
    }
  }
  return undefined;
};
const http = (status: number, body: unknown, headers: Record<string, string> = {}): never => {
  const head = [
    `HTTP/2.0 ${status} ${status === 304 ? "Not Modified" : "OK"}`,
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
  ];
  const text = body === undefined ? "" : JSON.stringify(body);
  return out(`${head.join("\r\n")}\r\n\r\n${text}`, status < 300 ? 0 : 1);
};

const nodes = <T>(items: T[]) => ({ nodes: items });
const user = (login: string) => ({ login, avatarUrl: FIXTURE_AVATARS[login] ?? null });
const at = (index: number) =>
  new Date(Date.parse("2026-10-01T08:00:00Z") + index * 60_000).toISOString();

const checkContext = (pr: FixturePullRequest) =>
  pr.checks.map((check) => ({
    __typename: "CheckRun",
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    detailsUrl: `https://github.com/${REPO}/actions/runs/${pr.number}/job/${check.name}`,
    startedAt: "2026-10-01T09:50:00Z",
    completedAt: check.status === "COMPLETED" ? "2026-10-01T09:55:00Z" : null,
    isRequired: check.isRequired,
    checkSuite: { workflowRun: { workflow: { name: "build" } }, app: { name: "GitHub Actions" } },
  }));

const head = (pr: FixturePullRequest) => ({
  number: pr.number,
  title: pr.title,
  url: `https://github.com/${REPO}/pull/${pr.number}`,
  state: pr.state,
  isDraft: pr.isDraft,
  headRefOid: pr.headRefOid,
  baseRefName: "main",
  mergeable: pr.state === "OPEN" ? pr.mergeable : "UNKNOWN",
  mergeStateStatus: pr.state === "OPEN" ? pr.mergeStateStatus : "UNKNOWN",
  reviewDecision: pr.reviewDecision,
  headCommit: nodes([
    {
      commit: {
        oid: pr.headRefOid,
        statusCheckRollup: pr.checks.length
          ? { state: "SUCCESS", contexts: nodes(checkContext(pr)) }
          : null,
      },
    },
  ]),
  reviewThreads: nodes(pr.threads.map((thread, index) => threadOf(pr, thread, index))),
});

const threadOf = (
  pr: FixturePullRequest,
  thread: FixturePullRequest["threads"][number],
  index: number,
) => ({
  id: `thread-${pr.number}-${index}`,
  isResolved: thread.resolved,
  isOutdated: false,
  path: thread.path,
  line: thread.line,
  comments: nodes(
    thread.comments.map((comment, position) => ({
      id: `rc-${pr.number}-${index}-${position}`,
      body: comment.body,
      createdAt: at(position + 40),
      url: null,
      diffHunk:
        "@@ -1,3 +1,4 @@\n export const pay = (cart: Cart) => {\n-  return checkout(cart);\n+  const total = cache(cart.id);",
      author: user(comment.author),
    })),
  ),
});

const commitOf = (commit: FixturePullRequest["commits"][number]) => ({
  oid: commit.oid,
  abbreviatedOid: commit.oid.slice(0, 7),
  messageHeadline: commit.headline,
  committedDate: commit.at,
  url: `https://github.com/${REPO}/commit/${commit.oid}`,
  authors: nodes([
    { name: commit.author, user: user(commit.author) },
    ...(commit.coAuthors ?? []).map(({ name, login }) => ({
      name,
      user: login ? user(login) : null,
    })),
  ]),
  statusCheckRollup: commit.rollup ? { state: commit.rollup } : null,
});

const timeline = (pr: FixturePullRequest) =>
  [
    ...pr.commits.map((commit) => ({
      at: commit.at,
      node: { __typename: "PullRequestCommit", commit: commitOf(commit) },
    })),
    ...pr.comments.map((comment, index) => ({
      at: comment.at,
      node: {
        __typename: "IssueComment",
        id: `c-${index}`,
        url: null,
        body: comment.body,
        createdAt: comment.at,
        author: user(comment.author),
      },
    })),
    ...pr.reviews.map((review, index) => ({
      at: review.at,
      node: {
        __typename: "PullRequestReview",
        id: `r-${index}`,
        url: null,
        state: review.state,
        body: review.body,
        submittedAt: review.at,
        createdAt: review.at,
        author: user(review.author),
      },
    })),
    ...pr.events.map((event) => ({
      at: event.at,
      node: {
        __typename: event.type,
        createdAt: event.at,
        actor: { login: event.actor },
        ...event.extra,
      },
    })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((item) => item.node);

const detail = (pr: FixturePullRequest) => ({
  ...head(pr),
  body: pr.body,
  createdAt: "2026-10-01T08:00:00Z",
  updatedAt: "2026-10-01T16:00:00Z",
  mergedAt: pr.state === "MERGED" ? "2026-10-01T15:00:00Z" : null,
  closedAt: pr.state === "OPEN" ? null : "2026-10-01T15:00:00Z",
  author: user(pr.author),
  headRefName: pr.headRefName,
  isCrossRepository: false,
  headRepositoryOwner: { login: "acme" },
  additions: pr.files.reduce((sum, file) => sum + file.additions, 0),
  deletions: pr.files.reduce((sum, file) => sum + file.deletions, 0),
  changedFiles: pr.files.length,
  labels: nodes(pr.labels),
  assignees: nodes(pr.assignees.map(user)),
  milestone: pr.milestone
    ? { title: pr.milestone, url: `https://github.com/${REPO}/milestone/1`, dueOn: null }
    : null,
  reviewRequests: nodes(
    pr.reviewRequests.map((login) => ({
      requestedReviewer: { __typename: "User", ...user(login) },
    })),
  ),
  latestReviews: nodes(
    pr.reviews.map((review) => ({ state: review.state, author: user(review.author) })),
  ),
  closingIssuesReferences: nodes(
    pr.linkedIssues.map((issue) => ({
      ...issue,
      url: `https://github.com/${REPO}/issues/${issue.number}`,
    })),
  ),
  comments: { totalCount: pr.comments.length },
  commits: {
    totalCount: pr.commits.length,
    nodes: pr.commits.map((commit) => ({ commit: commitOf(commit) })),
  },
  timelineItems: { totalCount: timeline(pr).length, nodes: timeline(pr) },
});

const lastRead = () =>
  Number(existsSync(join(dir, "last-read")) ? readFileSync(join(dir, "last-read"), "utf8") : 1);

const findPr = (prs: FixturePullRequest[], number: number) =>
  prs.find((pr) => pr.number === number);

const graphql = () => {
  if (flag("rate-limited")) fail("gh: API rate limit exceeded for user ID 1. (HTTP 403)");
  const query = field("query") ?? "";
  const pr = findPr(load(), Number(field("number")));
  writeFileSync(join(dir, "last-read"), String(field("number")));
  const repo = {
    viewerPermission: pr?.viewerPermission ?? "ADMIN",
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: true,
  };
  if (!pr) {
    out(
      JSON.stringify({
        data: { repository: { ...repo, pullRequest: null } },
        errors: [
          { message: `Could not resolve to a PullRequest with the number of ${field("number")}.` },
        ],
      }),
    );
  }
  const pullRequest = query.includes("query PullRequestChecks")
    ? head(pr as FixturePullRequest)
    : detail(pr as FixturePullRequest);
  out(JSON.stringify({ data: { repository: { ...repo, pullRequest } } }));
};

const restRead = (path: string) => {
  const etagSent = args[args.indexOf("-H") + 1]?.replace("If-None-Match: ", "") ?? null;
  const prs = load();
  const rules = path.match(/rules\/branches\//);
  const files = path.match(/pulls\/(\d+)\/files\?per_page=(\d+)&page=(\d+)/);
  let body: unknown = { message: "Not Found" };
  // GitHub answers rules per branch; the fixtures differ per pull request, so the one the host
  // read last (it reads the pull request, then its base's rules) decides.
  if (rules) body = findPr(prs, lastRead())?.rules ?? [];
  if (files) {
    const pr = findPr(prs, Number(files[1]));
    const size = Number(files[2]);
    const page = Number(files[3]);
    body = (pr?.files ?? []).slice((page - 1) * size, page * size);
  }
  const etag = `"${Bun.hash(JSON.stringify(body)).toString(16)}"`;
  if (etagSent === etag) http(304, undefined, { ETag: etag });
  http(Array.isArray(body) ? 200 : 404, body, { ETag: etag });
};

const repoPath = () => args.find((arg) => arg.startsWith("repos/")) ?? "";

const write = () => {
  const method = args[args.indexOf("-X") + 1];
  const path = repoPath();
  const prs = load();
  const number = Number(path.match(/(?:pulls|issues)\/(\d+)/)?.[1]);
  const pr = findPr(prs, number);
  if (!pr) fail("gh: Not Found (HTTP 404)");
  const target = pr as FixturePullRequest;
  const now = new Date().toISOString();
  const action = `${method} ${path.split("/").at(-1)}`;
  if (action.startsWith("PATCH")) patch(target, now);
  else WRITES[action]?.(target, now);
  save(prs);
  out("{}");
};

const REVIEW_STATE: Record<string, string> = {
  APPROVE: "APPROVED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
  COMMENT: "COMMENTED",
};

const review = (pr: FixturePullRequest, now: string) => {
  const event = field("event") ?? "COMMENT";
  if (pr.author === VIEWER && event !== "COMMENT") {
    fail("gh: Unprocessable Entity: Can not approve your own pull request (HTTP 422)");
  }
  const state = REVIEW_STATE[event] ?? "COMMENTED";
  pr.reviews.push({ author: VIEWER, state, body: field("body") ?? "", at: now });
  if (state !== "COMMENTED") pr.reviewDecision = state;
};

const comment = (pr: FixturePullRequest, now: string) => {
  pr.comments.push({ author: VIEWER, body: field("body") ?? "", at: now });
};

const merge = (pr: FixturePullRequest, now: string) => {
  if (flag("refuse-merge")) {
    rmSync(join(dir, "refuse-merge"));
    fail(
      'gh: Repository rule violations found\n\nRequired status check "security-scan" is expected. (HTTP 405)',
    );
  }
  if (field("sha") !== pr.headRefOid)
    fail("gh: Head branch was modified. Review and try the merge again. (HTTP 409)");
  pr.state = "MERGED";
  pr.events.push({
    type: "MergedEvent",
    actor: VIEWER,
    at: now,
    extra: { commit: { abbreviatedOid: "f00dfee" } },
  });
};

const WRITES: Record<string, (pr: FixturePullRequest, now: string) => void> = {
  "POST comments": (pr, now) => comment(pr, now),
  "POST reviews": (pr, now) => review(pr, now),
  "PUT merge": (pr, now) => merge(pr, now),
};

const patch = (pr: FixturePullRequest, now: string) => {
  const title = field("title");
  const state = field("state");
  if (title !== undefined) {
    pr.events.push({
      type: "RenamedTitleEvent",
      actor: VIEWER,
      at: now,
      extra: { previousTitle: pr.title, currentTitle: title },
    });
    pr.title = title;
  }
  if (state === "closed" || state === "open") {
    pr.state = state === "closed" ? "CLOSED" : "OPEN";
    pr.events.push({
      type: state === "closed" ? "ClosedEvent" : "ReopenedEvent",
      actor: VIEWER,
      at: now,
    });
  }
};

const ready = () => {
  const prs = load();
  const pr = findPr(prs, Number(args[2]));
  if (!pr) fail("no pull requests found");
  const target = pr as FixturePullRequest;
  const undo = args.includes("--undo");
  target.isDraft = undo;
  target.mergeStateStatus = undo
    ? "DRAFT"
    : target.mergeStateStatus === "DRAFT"
      ? "BLOCKED"
      : target.mergeStateStatus;
  target.events.push({
    type: undo ? "ConvertToDraftEvent" : "ReadyForReviewEvent",
    actor: VIEWER,
    at: new Date().toISOString(),
  });
  save(prs);
  out(
    `✓ Pull request #${target.number} is ${undo ? "converted to draft" : "marked as ready for review"}\n`,
  );
};

const [command, sub] = args;
if (command === "fake" && sub === "reset") {
  rmSync(statePath, { force: true });
  out("reset\n");
}
if (command === "auth" && sub === "status")
  flag("signed-out")
    ? fail("You are not logged into any GitHub hosts. To log in, run: gh auth login")
    : out("Logged in\n");
if (command === "api" && sub === "user")
  flag("signed-out")
    ? fail("gh: To get started with GitHub CLI, please run:  gh auth login")
    : out(`${VIEWER}\n`);
if (command === "api" && sub === "graphql") graphql();
if (command === "api" && sub === "-i") restRead(repoPath());
if (command === "api" && sub === "-X") write();
if (command === "pr" && sub === "ready") ready();
fail(`fake-gh-pr-view: unsupported call: gh ${args.join(" ")}`);
