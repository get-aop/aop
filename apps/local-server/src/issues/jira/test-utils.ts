import type { JiraCredentials } from "@aop/common";
import type { JiraApi, JiraFailure, JiraIssueNode, JiraRead } from "./jira-api.ts";
import type { JiraConnectionStore, StoredJiraConnection } from "./jira-connection-store.ts";

export const JIRA_TOKEN = "jira_secret_token";

export const cloudCredentials = (overrides: Partial<JiraCredentials> = {}): JiraCredentials =>
  ({
    deployment: "cloud",
    siteUrl: "https://acme.atlassian.net",
    email: "sam@acme.test",
    apiToken: JIRA_TOKEN,
    ...overrides,
  }) as JiraCredentials;

export const jiraConnection = (
  overrides: Partial<StoredJiraConnection> = {},
): StoredJiraConnection => ({
  credentials: cloudCredentials(),
  account: "Sam Rivera",
  filter: { projects: ["APP"], jql: null },
  linkPullRequests: true,
  ...overrides,
});

/** A Jira issue as the search answers it, with whatever the test changes in its fields. */
export const jiraNode = (key = "APP-3", fields: Record<string, unknown> = {}): JiraIssueNode => ({
  id: key.replace(/\D/g, "") || "1",
  key,
  fields: {
    summary: "Sign in with SSO",
    status: { name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress" } },
    resolution: null,
    assignee: {
      displayName: "Mia Krystof",
      avatarUrls: { "48x48": "https://secure.gravatar.com/avatar/abc?s=48" },
    },
    reporter: { displayName: "Sam Rivera", avatarUrls: {} },
    priority: { name: "High" },
    labels: ["auth"],
    components: [{ name: "Backend" }],
    fixVersions: [{ name: "2.4.0" }],
    project: { key: "APP", name: "Mobile App" },
    created: "2026-09-20T10:00:00.000+0000",
    updated: "2026-09-28T14:03:11.000+0000",
    ...fields,
  },
});

/** A Jira connection store held in memory. */
export const memoryJiraStore = (initial: Record<string, StoredJiraConnection> = {}) => {
  const held = new Map(Object.entries(initial));
  const store: JiraConnectionStore = {
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

const REFUSED: JiraFailure = {
  kind: "unauthorized",
  message: "Jira refused the token: it may have expired or been revoked",
};

/**
 * A Jira answering from a list, refusing any token but `JIRA_TOKEN`. `failNext` makes the next
 * call fail as given; a JQL containing `bogus` is refused as bad. Every call is recorded.
 */
export const scriptedJira = (issues: JiraIssueNode[] = [jiraNode()]) => {
  const calls: string[] = [];
  const state: { failNext: JiraFailure | null } = { failNext: null };
  const gate = (credentials: JiraCredentials, call: string): JiraFailure | null => {
    calls.push(call);
    const failure = state.failNext;
    state.failNext = null;
    if (failure) return failure;
    const token = credentials.deployment === "cloud" ? credentials.apiToken : credentials.token;
    return token === JIRA_TOKEN ? null : REFUSED;
  };
  const refusedWith = (failure: JiraFailure): JiraRead<never> => ({ ok: false, failure });
  const api: JiraApi = {
    myself: async (credentials) => {
      const failure = gate(credentials, "myself");
      if (failure) return refusedWith(failure);
      return {
        ok: true,
        value: { displayName: "Sam Rivera", email: "sam@acme.test", avatarUrl: null },
      };
    },
    projects: async (credentials) => {
      const failure = gate(credentials, "projects");
      if (failure) return refusedWith(failure);
      return { ok: true, value: [{ key: "APP", name: "Mobile App" }] };
    },
    searchPage: async (credentials, { jql, maxResults, cursor }) => {
      const failure = gate(credentials, `search ${jql} cursor=${cursor ?? "-"}`);
      if (failure) return refusedWith(failure);
      if (jql.includes("bogus")) {
        return refusedWith({ kind: "bad-request", message: "Field 'bogus' does not exist." });
      }
      const from = Number(cursor ?? 0);
      const page = issues.slice(from, from + maxResults);
      const next = from + page.length < issues.length ? String(from + page.length) : null;
      return { ok: true, value: { issues: page, next } };
    },
    issue: async (credentials, key) => {
      const failure = gate(credentials, `issue ${key}`);
      if (failure) return refusedWith(failure);
      const node = issues.find((issue) => issue.key === key);
      if (!node) return { ok: true, value: null };
      return {
        ok: true,
        value: {
          issue: {
            ...node,
            fields: {
              ...node.fields,
              description: adfParagraph("Users sign in with **SSO**."),
              customfield_10050: adfParagraph("Signs in with Okta"),
              comment: {
                total: 1,
                comments: [
                  {
                    id: "10001",
                    author: { displayName: "Sam Rivera", avatarUrls: {} },
                    body: adfParagraph("On it"),
                    created: "2026-09-29T08:00:00.000+0000",
                  },
                ],
              },
            },
          },
          names: { summary: "Summary", customfield_10050: "Acceptance criteria" },
        },
      };
    },
  };
  return { api, calls, state };
};

export const adfParagraph = (text: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
