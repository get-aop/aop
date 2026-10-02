import type {
  PullRequestViewCheck,
  PullRequestViewDetail,
  PullRequestViewFile,
  PullRequestViewFilesResponse,
} from "@aop/common";
import { hostError, json, type mockHost } from "../thread/test-utils";

const AT = "2026-10-01T10:00:00.000Z";

export const makeCheck = (overrides: Partial<PullRequestViewCheck> = {}): PullRequestViewCheck => ({
  name: "test",
  workflow: "build",
  status: "success",
  required: true,
  url: "https://github.com/acme/app/actions/runs/1/job/2",
  description: null,
  startedAt: AT,
  completedAt: AT,
  ...overrides,
});

/** An open pull request of `ada`, ready to merge, that the host owner may act on. */
export const makeDetail = (
  overrides: Partial<PullRequestViewDetail> = {},
): PullRequestViewDetail => ({
  repoId: "repo_1",
  nameWithOwner: "acme/app",
  number: 752,
  title: "Show monster ability impacts",
  url: "https://github.com/acme/app/pull/752",
  state: "open",
  isDraft: false,
  body: "## Why\n\nImpacts were **invisible**.",
  author: { login: "ada", avatarUrl: null },
  createdAt: AT,
  updatedAt: AT,
  mergedAt: null,
  closedAt: null,
  baseRefName: "main",
  headRefName: "ticket/impacts",
  headLabel: "ticket/impacts",
  headSha: "a".repeat(40),
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  commitCount: 1,
  commentCount: 1,
  labels: [{ name: "client", color: "a2eeef" }],
  assignees: [{ login: "ada", avatarUrl: null }],
  milestone: { title: "v1", url: "https://github.com/acme/app/milestone/1", dueOn: null },
  reviewers: [{ login: "bob", avatarUrl: null, isTeam: false, state: "approved" }],
  linkedIssues: [
    {
      number: 3,
      title: "Impacts are invisible",
      url: "https://github.com/acme/app/issues/3",
      state: "open",
    },
  ],
  checks: {
    state: "success",
    total: 1,
    successful: 1,
    failing: 0,
    pending: 0,
    skipped: 0,
    items: [makeCheck()],
  },
  commits: [
    {
      sha: "a".repeat(40),
      shortSha: "aaaaaaa",
      headline: "Draw impacts",
      url: "https://github.com/acme/app/commit/aaaaaaa",
      committedAt: AT,
      authors: [{ login: "ada", avatarUrl: null }],
      checks: "success",
    },
  ],
  timeline: [
    {
      kind: "comment",
      id: "c1",
      author: { login: "bob", avatarUrl: null },
      body: "Looks **good**",
      createdAt: AT,
      url: null,
    },
  ],
  timelineOmitted: 0,
  reviewThreads: [],
  merge: {
    status: "ready",
    blockers: [],
    warnings: [],
    conflicts: "none",
    methods: ["squash", "merge", "rebase"],
    missingRequiredChecks: [],
  },
  viewer: { canWrite: true, readOnlyReason: null, login: "owner" },
  fetchedAt: AT,
  ...overrides,
});

export const makeFile = (overrides: Partial<PullRequestViewFile> = {}): PullRequestViewFile => ({
  path: "src/impacts.ts",
  previousPath: null,
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;",
  ...overrides,
});

const PULL = /\/github\/repos\/([^/]+)\/pulls\/(\d+)(\/[a-z]+)?(\?.*)?$/;

/**
 * Answers the PR View's requests from `state`: the page, its checks, its files and the writes
 * (which succeed unless `refuse` names them). Anything else gets what `fallback` answers.
 */
export const answerPullRequests = (
  host: ReturnType<typeof mockHost>,
  state: {
    detail: PullRequestViewDetail | Response;
    files?: PullRequestViewFilesResponse;
    refuse?: Partial<Record<string, Response>>;
  },
  fallback: (url: string) => Response = () => hostError(404, "NOT_FOUND", "not found"),
) => {
  host.respondWith(({ url, method }) => {
    if (url.endsWith("/github/status")) {
      return json({
        auth: { authenticated: true, login: "owner" },
        repos: [{ repoId: "repo_1", name: "app", nameWithOwner: "acme/app" }],
      });
    }
    const match = PULL.exec(url);
    if (!match) return fallback(url);
    const suffix = match[3] ?? "";
    if (method !== "GET") return state.refuse?.[`${method} ${suffix}`] ?? json({ ok: true });
    return readAnswer(state, suffix);
  });
};

const readAnswer = (
  state: { detail: PullRequestViewDetail | Response; files?: PullRequestViewFilesResponse },
  suffix: string,
): Response => {
  if (suffix === "/files") return json(state.files ?? { files: [makeFile()], truncated: false });
  const detail = state.detail;
  if (detail instanceof Response) return detail.clone();
  if (suffix !== "/checks") return json(detail);
  const { state: shown, headSha, checks, merge } = detail;
  return json({ state: shown, headSha, checks, merge, fetchedAt: AT });
};
