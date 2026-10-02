import type { GithubAuth, GithubProjectRepo } from "@aop/common";
import type { RestResponse } from "../github/index.ts";
import type { GhRead } from "../github-cli/read.ts";
import type { IssuesGithub } from "./github-issues.ts";
import type { GithubIssueNode } from "./github-mapping.ts";
import type { LinearApi, LinearIssueNode } from "./linear-api.ts";
import type { LinearConnectionStore, StoredLinearConnection } from "./linear-connection-store.ts";

/** A GitHub issue as the GraphQL API returns it, with whatever the test changes. */
export const githubNode = (overrides: Partial<GithubIssueNode> = {}): GithubIssueNode => ({
  number: 12,
  title: "Fix the flaky test",
  url: "https://github.com/acme/app/issues/12",
  state: "OPEN",
  stateReason: null,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  author: { login: "ada", name: "Ada", avatarUrl: "https://avatars.example/ada" },
  assignees: { nodes: [] },
  labels: { nodes: [] },
  milestone: null,
  comments: { totalCount: 0 },
  closedByPullRequestsReferences: { nodes: [] },
  ...overrides,
});

/** `count` issues numbered down from `from`, newest update first. */
export const githubNodes = (count: number, from = 500): GithubIssueNode[] =>
  Array.from({ length: count }, (_, index) =>
    githubNode({
      number: from - index,
      title: `Issue ${from - index}`,
      updatedAt: new Date(Date.UTC(2026, 8, 30) - index * 60_000).toISOString(),
    }),
  );

/**
 * A scripted GitHub for the issues loader: `issues` is what the repository holds, `etag` what
 * the probe answers (a matching `If-None-Match` gets a 304). Every call is recorded.
 */
export const scriptedGithub = (state: {
  issues: GithubIssueNode[];
  etag?: string;
  fail?: string | null;
}) => {
  const calls: string[] = [];
  const github: IssuesGithub = {
    restGet: async (path, options): Promise<GhRead<RestResponse>> => {
      calls.push(`probe ${path} ${options?.etag ?? "-"}`);
      if (state.fail) return { ok: false, message: state.fail, rateLimited: false };
      const etag = state.etag ?? "v1";
      return options?.etag === etag
        ? { ok: true, value: { notModified: true, etag } }
        : { ok: true, value: { notModified: false, etag, body: [] } };
    },
    graphql: async <T>(_query: string, variables: Record<string, unknown>) => {
      if ("number" in variables) return issueBody<T>(state.issues, Number(variables.number), calls);
      const after = Number(variables.after ?? 0);
      const first = Number(variables.first);
      calls.push(`graphql after=${after}`);
      if (state.fail) return { ok: false, message: state.fail, rateLimited: false } as GhRead<T>;
      const page = state.issues.slice(after, after + first);
      return {
        ok: true,
        value: {
          repository: {
            issues: {
              pageInfo: {
                hasNextPage: after + first < state.issues.length,
                endCursor: String(after + page.length),
              },
              nodes: page,
            },
          },
        } as T,
      } as GhRead<T>;
    },
  };
  return { github, calls };
};

const issueBody = <T>(issues: GithubIssueNode[], number: number, calls: string[]): GhRead<T> => {
  calls.push(`graphql issue #${number}`);
  const node = issues.find((issue) => issue.number === number);
  if (!node) {
    return {
      ok: false,
      message: "Could not resolve to an Issue with the number",
      rateLimited: false,
    };
  }
  const issue = { number, title: node.title, url: node.url, body: "Steps to reproduce." };
  return { ok: true, value: { repository: { issue } } as T };
};

export const repoRef = (overrides: Partial<GithubProjectRepo> = {}): GithubProjectRepo => ({
  repoId: "repo_1",
  name: "app",
  nameWithOwner: "acme/app",
  ...overrides,
});

export const SIGNED_IN: GithubAuth = { authenticated: true, login: "ada" };

export const linearNode = (overrides: Partial<LinearIssueNode> = {}): LinearIssueNode => ({
  identifier: "ENG-7",
  title: "Ship the onboarding",
  url: "https://linear.app/acme/issue/ENG-7",
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-03T10:00:00Z",
  state: { name: "In Progress", type: "started", color: "#f2c94c" },
  labels: { nodes: [{ name: "Feature", color: "#bb87fc" }] },
  assignee: { name: "Sam Rivera", displayName: "sam", avatarUrl: null },
  creator: { name: "Ana", displayName: "ana", avatarUrl: "https://avatars.example/ana" },
  cycle: { name: null, number: 14 },
  projectMilestone: null,
  comments: { nodes: [{ id: "c1" }, { id: "c2" }] },
  ...overrides,
});

export const linearConnection = (
  overrides: Partial<StoredLinearConnection> = {},
): StoredLinearConnection => ({
  apiKey: "lin_api_secret",
  scope: { kind: "team", id: "team-1", name: "Engineering" },
  workspace: "Acme",
  viewer: "sam",
  ...overrides,
});

/** A Linear connection store held in memory. */
export const memoryLinearStore = (initial: Record<string, StoredLinearConnection> = {}) => {
  const held = new Map(Object.entries(initial));
  const store: LinearConnectionStore = {
    read: async (projectId) => held.get(projectId) ?? null,
    write: async (projectId, connection) => {
      held.set(projectId, connection);
    },
    remove: async (projectId) => {
      held.delete(projectId);
    },
  };
  return { store, held };
};

/** A Linear API answering from a list, refusing any key but `lin_api_secret`. */
export const scriptedLinear = (issues: LinearIssueNode[] = [linearNode()]) => {
  const keys: string[] = [];
  const ok = (key: string) => {
    keys.push(key);
    return key === "lin_api_secret";
  };
  const refused = { ok: false as const, unauthorized: true, message: "Linear refused the API key" };
  const api: LinearApi = {
    catalog: async (key) =>
      ok(key)
        ? {
            ok: true,
            value: {
              workspace: "Acme",
              viewer: "sam",
              teams: [{ id: "team-1", key: "ENG", name: "Engineering" }],
              projects: [],
            },
          }
        : refused,
    issuePage: async (key, { scope }) => {
      if (!ok(key)) return refused;
      const { mapLinearIssue } = await import("./linear-api.ts");
      return {
        ok: true,
        value: {
          issues: issues.map((node) => mapLinearIssue(node, scope)),
          hasNextPage: false,
          endCursor: null,
        },
      };
    },
    issueBody: async (key, identifier) => {
      if (!ok(key)) return refused;
      const node = issues.find((issue) => issue.identifier === identifier);
      return {
        ok: true,
        value: node ? { title: node.title, url: node.url, body: "From Linear." } : null,
      };
    },
  };
  return { api, keys };
};
