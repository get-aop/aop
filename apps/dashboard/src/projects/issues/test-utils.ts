import type { IssueList, IssueSourceStatus, ProjectIssue } from "@aop/common";

/** An issue as the host lists it, with whatever the test changes. */
export const makeIssue = (overrides: Partial<ProjectIssue> = {}): ProjectIssue => ({
  key: "github:acme/app#1",
  source: "github",
  repoId: "repo_1",
  container: "acme/app",
  identifier: "#1",
  title: "First issue",
  url: "https://github.com/acme/app/issues/1",
  state: "open",
  stage: "unstarted",
  stateName: "Open",
  stateColor: null,
  labels: [],
  assignees: [],
  author: { login: "ada", name: null, avatarUrl: null },
  milestone: null,
  priority: null,
  commentCount: 0,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
  linkedPullRequests: [],
  ...overrides,
});

export const sourceStatus = (overrides: Partial<IssueSourceStatus> = {}): IssueSourceStatus => ({
  source: "github",
  id: "repo_1",
  name: "acme/app",
  status: "ok",
  message: null,
  hasMore: false,
  stale: false,
  fetchedAt: "2026-09-02T10:00:00.000Z",
  ...overrides,
});

export const LINEAR_NOT_CONFIGURED = sourceStatus({
  source: "linear",
  id: "linear",
  name: "Linear",
  status: "not-configured",
  fetchedAt: null,
});

export const JIRA_NOT_CONFIGURED = sourceStatus({
  source: "jira",
  id: "jira",
  name: "Jira",
  status: "not-configured",
  fetchedAt: null,
});

export const issueList = (
  issues: ProjectIssue[],
  sources: IssueSourceStatus[] = [sourceStatus(), LINEAR_NOT_CONFIGURED, JIRA_NOT_CONFIGURED],
): IssueList => ({ issues, sources });

/** A few issues across states, labels, people and sources. */
export const SAMPLE: ProjectIssue[] = [
  makeIssue({
    key: "github:acme/app#3",
    identifier: "#3",
    title: "Crash on start",
    labels: [{ name: "bug", color: "d73a4a" }],
    assignees: [{ login: "bo", name: null, avatarUrl: null }],
    milestone: "v1",
    commentCount: 5,
    updatedAt: "2026-09-05T10:00:00.000Z",
    createdAt: "2026-08-01T10:00:00.000Z",
    linkedPullRequests: [
      {
        repoId: "repo_1",
        nameWithOwner: "acme/app",
        number: 40,
        title: "Fix the crash",
        url: "https://github.com/acme/app/pull/40",
        state: "open",
        checks: "failing",
      },
      {
        repoId: null,
        nameWithOwner: "acme/other",
        number: 7,
        title: "Elsewhere",
        url: "https://github.com/acme/other/pull/7",
        state: "merged",
        checks: null,
      },
    ],
  }),
  makeIssue({
    key: "github:acme/app#2",
    identifier: "#2",
    title: "Dark mode",
    labels: [
      { name: "enhancement", color: "a2eeef" },
      { name: "bug", color: "d73a4a" },
    ],
    author: { login: "cy", name: null, avatarUrl: null },
    commentCount: 1,
    updatedAt: "2026-09-04T10:00:00.000Z",
    createdAt: "2026-08-20T10:00:00.000Z",
  }),
  makeIssue({
    key: "linear:ENG-9",
    source: "linear",
    repoId: null,
    container: "Engineering",
    identifier: "ENG-9",
    title: "Onboarding checklist",
    stage: "started",
    stateName: "In Progress",
    stateColor: "f2c94c",
    url: "https://linear.app/acme/issue/ENG-9",
    milestone: "Cycle 3",
    updatedAt: "2026-09-03T10:00:00.000Z",
    createdAt: "2026-08-25T10:00:00.000Z",
  }),
  makeIssue({
    key: "github:acme/app#1",
    identifier: "#1",
    title: "Old done thing",
    state: "closed",
    stage: "completed",
    stateName: "Closed",
    updatedAt: "2026-09-01T10:00:00.000Z",
    createdAt: "2026-07-01T10:00:00.000Z",
  }),
];
