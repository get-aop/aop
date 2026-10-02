/**
 * Fixture issues for verifying the Issues tab: a GitHub repository's issues (served by
 * fake-gh-issues.ts) and a Linear team's (served by fake-linear.ts). Times are relative to now,
 * so ages read naturally on any day. `version` changes one issue, the way an edit on GitHub
 * would, so a check can see the host notice it.
 */

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const people = {
  ana: { login: "ana-k", name: "Ana Kowalski", avatarUrl: null },
  ben: { login: "bennyo", name: "Ben Okafor", avatarUrl: null },
  mia: { login: "mia-dev", name: "Mia Laurent", avatarUrl: null },
  marcelo: {
    login: "marcelormendes",
    name: "Marcelo Ribeiro Mendes",
    avatarUrl: "https://avatars.githubusercontent.com/u/23131717?v=4",
  },
};

const labels = {
  bug: { name: "bug", color: "d73a4a" },
  feature: { name: "enhancement", color: "a2eeef" },
  docs: { name: "documentation", color: "0075ca" },
  perf: { name: "performance", color: "f9d0c4" },
  design: { name: "design", color: "d4c5f9" },
  good: { name: "good first issue", color: "7057ff" },
  security: { name: "security", color: "b60205" },
};

type Pr = {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  checks?: "SUCCESS" | "FAILURE" | "PENDING";
  repo?: string;
};

interface FixtureIssue {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  stateReason?: "COMPLETED" | "NOT_PLANNED";
  hours: number;
  author: (typeof people)[keyof typeof people];
  assignees?: (typeof people)[keyof typeof people][];
  labels?: (typeof labels)[keyof typeof labels][];
  milestone?: string;
  comments?: number;
  prs?: Pr[];
  body?: string;
}

const GITHUB_ISSUES: FixtureIssue[] = [
  {
    number: 142,
    title: "Threads panel flickers when a run streams long tool output",
    state: "OPEN",
    hours: 0.3,
    author: people.ana,
    assignees: [people.marcelo],
    labels: [labels.bug, labels.perf],
    milestone: "v0.11",
    comments: 7,
    prs: [
      {
        number: 151,
        title: "Batch tool-output parts before render",
        state: "OPEN",
        checks: "FAILURE",
      },
    ],
    body: "When a thread runs `bun test`, the panel re-renders every chunk.\n\nSteps:\n1. Start a thread that runs the full suite\n2. Watch the panel\n\nExpected: smooth updates.",
  },
  {
    number: 139,
    title: "Add keyboard shortcuts to jump between threads",
    state: "OPEN",
    hours: 2,
    author: people.ben,
    assignees: [people.ben, people.mia],
    labels: [labels.feature, labels.design],
    milestone: "v0.11",
    comments: 3,
    prs: [
      {
        number: 150,
        title: "Thread switcher shortcuts",
        state: "OPEN",
        isDraft: true,
        checks: "PENDING",
      },
    ],
  },
  {
    number: 137,
    title: "Coordinator loses the draft when the panel is expanded",
    state: "OPEN",
    hours: 5,
    author: people.mia,
    assignees: [people.ana],
    labels: [labels.bug],
    milestone: "v0.11",
    comments: 12,
    prs: [
      {
        number: 148,
        title: "Keep the composer mounted under the expanded panel",
        state: "OPEN",
        checks: "SUCCESS",
      },
      { number: 77, title: "Shared composer state", state: "CLOSED", repo: "acme/design-system" },
    ],
  },
  {
    number: 133,
    title: "Document the release environment and its two approvals",
    state: "OPEN",
    hours: 20,
    author: people.marcelo,
    labels: [labels.docs, labels.good],
    milestone: "v0.12",
    comments: 1,
  },
  {
    number: 131,
    title: "Usage meter shows 0% right after a plan reset",
    state: "OPEN",
    hours: 30,
    author: people.ben,
    assignees: [people.marcelo],
    labels: [labels.bug],
    comments: 4,
  },
  {
    number: 128,
    title: "Search threads by branch name",
    state: "OPEN",
    hours: 52,
    author: people.ana,
    labels: [labels.feature, labels.good],
    milestone: "v0.12",
    comments: 0,
  },
  {
    number: 126,
    title: "Pairing code screen is unreadable at 200% zoom",
    state: "OPEN",
    hours: 70,
    author: people.mia,
    assignees: [people.mia],
    labels: [labels.bug, labels.design],
    comments: 2,
  },
  {
    number: 121,
    title: "Rotate the MCP secret from the settings dialog",
    state: "OPEN",
    hours: 96,
    author: people.marcelo,
    labels: [labels.security, labels.feature],
    milestone: "v0.12",
    comments: 5,
    prs: [{ number: 135, title: "Settings: rotate MCP secret", state: "OPEN", checks: "SUCCESS" }],
  },
  {
    number: 118,
    title: "Worktree cleanup leaves empty folders behind",
    state: "OPEN",
    hours: 140,
    author: people.ben,
    labels: [labels.bug, labels.perf],
    comments: 0,
  },
  {
    number: 115,
    title: "Show the model each thread ran on in its header",
    state: "OPEN",
    hours: 200,
    author: people.ana,
    assignees: [people.ana],
    labels: [labels.feature],
    milestone: "v0.11",
    comments: 6,
  },
  {
    number: 112,
    title: "Slow first paint on projects with 300+ threads",
    state: "OPEN",
    hours: 260,
    author: people.mia,
    labels: [labels.perf],
    comments: 9,
  },
  {
    number: 109,
    title: "Explain why a thread is rate-limited",
    state: "OPEN",
    hours: 400,
    author: people.marcelo,
    assignees: [people.ben],
    labels: [labels.design],
    milestone: "v0.12",
    comments: 2,
  },
  {
    number: 104,
    title: "Copy a thread's branch name from its card",
    state: "CLOSED",
    stateReason: "COMPLETED",
    hours: 10,
    author: people.ana,
    assignees: [people.ana],
    labels: [labels.feature, labels.good],
    milestone: "v0.11",
    comments: 3,
    prs: [{ number: 147, title: "Copy branch from the thread card", state: "MERGED" }],
  },
  {
    number: 101,
    title: "Crash when a repository is removed mid-run",
    state: "CLOSED",
    stateReason: "COMPLETED",
    hours: 48,
    author: people.ben,
    assignees: [people.marcelo],
    labels: [labels.bug],
    milestone: "v0.11",
    comments: 8,
    prs: [{ number: 140, title: "Guard removed repos in the run loop", state: "MERGED" }],
  },
  {
    number: 98,
    title: "Support Windows as a host",
    state: "CLOSED",
    stateReason: "NOT_PLANNED",
    hours: 120,
    author: people.mia,
    labels: [labels.feature],
    comments: 15,
  },
  {
    number: 95,
    title: "Dark theme contrast for code blocks",
    state: "CLOSED",
    stateReason: "COMPLETED",
    hours: 300,
    author: people.mia,
    assignees: [people.mia],
    labels: [labels.design],
    comments: 2,
    prs: [{ number: 120, title: "Raise code block contrast", state: "MERGED" }],
  },
  {
    number: 90,
    title: "Duplicate of #101",
    state: "CLOSED",
    stateReason: "NOT_PLANNED",
    hours: 500,
    author: people.ben,
    labels: [],
    comments: 1,
  },
];

const node = (issue: FixtureIssue, nameWithOwner: string) => ({
  number: issue.number,
  title: issue.title,
  url: `https://github.com/${nameWithOwner}/issues/${issue.number}`,
  state: issue.state,
  stateReason: issue.state === "CLOSED" ? (issue.stateReason ?? "COMPLETED") : null,
  createdAt: ago(issue.hours + 72),
  updatedAt: ago(issue.hours),
  author: issue.author,
  assignees: { nodes: issue.assignees ?? [] },
  labels: { nodes: issue.labels ?? [] },
  milestone: issue.milestone ? { title: issue.milestone } : null,
  comments: { totalCount: issue.comments ?? 0 },
  closedByPullRequestsReferences: {
    nodes: (issue.prs ?? []).map((pr) => {
      const repo = pr.repo ?? nameWithOwner;
      return {
        number: pr.number,
        title: pr.title,
        url: `https://github.com/${repo}/pull/${pr.number}`,
        state: pr.state,
        isDraft: pr.isDraft ?? false,
        repository: { nameWithOwner: repo },
        commits: {
          nodes: pr.checks ? [{ commit: { statusCheckRollup: { state: pr.checks } } }] : [],
        },
      };
    }),
  },
  body: issue.body ?? `${issue.title}.\n\nReported by @${issue.author.login}.`,
});

/** The repository's issues as GitHub's GraphQL API returns them, newest update first. */
export const githubIssueNodes = (nameWithOwner: string, version: number) =>
  GITHUB_ISSUES.map((issue, index) => {
    const edited = version > 0 && index === 3;
    return node(
      edited ? { ...issue, title: `${issue.title} (edited ${version})`, hours: 0 } : issue,
      nameWithOwner,
    );
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const linearPeople = {
  sam: { name: "Sam Rivera", displayName: "sam", avatarUrl: null },
  ana: { name: "Ana Kowalski", displayName: "ana", avatarUrl: null },
};

const linearStates = {
  triage: { name: "Triage", type: "triage", color: "#fc7840" },
  backlog: { name: "Backlog", type: "backlog", color: "#bec2c8" },
  todo: { name: "Todo", type: "unstarted", color: "#e2e2e2" },
  progress: { name: "In Progress", type: "started", color: "#f2c94c" },
  review: { name: "In Review", type: "started", color: "#0f783c" },
  done: { name: "Done", type: "completed", color: "#5e6ad2" },
  canceled: { name: "Canceled", type: "canceled", color: "#95a2b3" },
};

const linearLabels = {
  bug: { name: "Bug", color: "#eb5757" },
  feature: { name: "Feature", color: "#bb87fc" },
  improvement: { name: "Improvement", color: "#4ea7fc" },
};

const LINEAR_ISSUES = [
  {
    n: 41,
    title: "Onboarding checklist for new projects",
    state: linearStates.progress,
    hours: 1,
    assignee: linearPeople.sam,
    labels: [linearLabels.feature],
    cycle: 14,
    comments: 4,
  },
  {
    n: 39,
    title: "Desktop notification sound setting",
    state: linearStates.review,
    hours: 6,
    assignee: linearPeople.ana,
    labels: [linearLabels.improvement],
    cycle: 14,
    comments: 2,
  },
  {
    n: 38,
    title: "Project tiles lose their colour after rename",
    state: linearStates.triage,
    hours: 9,
    assignee: null,
    labels: [linearLabels.bug],
    cycle: null,
    comments: 0,
  },
  {
    n: 36,
    title: "Export a thread transcript as Markdown",
    state: linearStates.todo,
    hours: 30,
    assignee: linearPeople.sam,
    labels: [linearLabels.feature],
    cycle: 15,
    comments: 1,
  },
  {
    n: 33,
    title: "Faster cold start for the host",
    state: linearStates.backlog,
    hours: 90,
    assignee: null,
    labels: [linearLabels.improvement],
    cycle: null,
    comments: 3,
  },
  {
    n: 30,
    title: "Settings search",
    state: linearStates.done,
    hours: 20,
    assignee: linearPeople.ana,
    labels: [linearLabels.feature],
    cycle: 13,
    comments: 5,
  },
  {
    n: 27,
    title: "Legacy importer",
    state: linearStates.canceled,
    hours: 150,
    assignee: null,
    labels: [],
    cycle: null,
    comments: 0,
  },
];

/** The team's issues as Linear's GraphQL API returns them. */
export const linearIssueNodes = () =>
  LINEAR_ISSUES.map((issue) => ({
    identifier: `APP-${issue.n}`,
    title: issue.title,
    url: `https://linear.app/acme/issue/APP-${issue.n}`,
    createdAt: ago(issue.hours + 48),
    updatedAt: ago(issue.hours),
    state: issue.state,
    labels: { nodes: issue.labels },
    assignee: issue.assignee,
    creator: linearPeople.sam,
    cycle: issue.cycle ? { name: null, number: issue.cycle } : null,
    projectMilestone: null,
    comments: {
      nodes: Array.from({ length: issue.comments }, (_, index) => ({ id: `c${index}` })),
    },
    description: `${issue.title}: details for the thread.`,
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const LINEAR_CATALOG = {
  viewer: { name: "Sam Rivera", displayName: "sam" },
  organization: { name: "Acme" },
  teams: {
    nodes: [
      { id: "team-app", key: "APP", name: "App" },
      { id: "team-ops", key: "OPS", name: "Operations" },
    ],
  },
  projects: {
    nodes: [
      { id: "proj-onboarding", name: "Onboarding revamp", teams: { nodes: [{ key: "APP" }] } },
    ],
  },
};
