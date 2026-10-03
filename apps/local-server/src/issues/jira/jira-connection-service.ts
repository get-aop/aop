import {
  JIRA_NOT_CONNECTED,
  type JiraConnectInput,
  type JiraConnection,
  type JiraCredentials,
  type JiraFilter,
  type JiraTestInput,
  type JiraTestResult,
} from "@aop/common";
import type { IssueError, IssueResult } from "../service.ts";
import type { JiraApi, JiraFailure } from "./jira-api.ts";
import type { JiraConnectionStore, StoredJiraConnection } from "./jira-connection-store.ts";
import type { JiraIssueLoader } from "./jira-issues.ts";
import { jiraListJql, splitOrderBy } from "./jira-jql.ts";

export interface JiraConnectionService {
  /** Whether Jira is connected and to what; any client may ask. Never the token or the email. */
  connection: (projectId: string) => Promise<IssueResult<{ connection: JiraConnection }>>;
  /** Host owner only: who the credentials (or the stored ones) sign in as, and their projects. */
  test: (
    projectId: string,
    input: JiraTestInput,
  ) => Promise<IssueResult<{ result: JiraTestResult }>>;
  /** Host owner only: signs in and runs the filter once, then keeps both. */
  connect: (
    projectId: string,
    input: JiraConnectInput,
  ) => Promise<IssueResult<{ connection: JiraConnection }>>;
  disconnect: (projectId: string) => Promise<IssueResult<Record<never, never>>>;
}

export interface JiraConnectionDeps {
  projectExists: (projectId: string) => Promise<boolean>;
  jira: JiraApi;
  jiraIssues: Pick<JiraIssueLoader, "forget">;
  jiraStore: JiraConnectionStore;
}

const NOT_FOUND = { success: false, error: { code: "PROJECT_NOT_FOUND" } } as const;

export const createJiraConnectionService = (deps: JiraConnectionDeps): JiraConnectionService => {
  const { jira, jiraStore } = deps;

  const credentialsFor = async (
    projectId: string,
    given: JiraCredentials | undefined,
  ): Promise<JiraCredentials | null> =>
    given ?? (await jiraStore.read(projectId))?.credentials ?? null;

  return {
    connection: async (projectId) => {
      if (!(await deps.projectExists(projectId))) return NOT_FOUND;
      return { success: true, connection: publicConnection(await jiraStore.read(projectId)) };
    },

    test: async (projectId, input) => {
      if (!(await deps.projectExists(projectId))) return NOT_FOUND;
      const credentials = await credentialsFor(projectId, input.credentials);
      if (!credentials) return { success: false, error: { code: "JIRA_NOT_CONFIGURED" } };
      const account = await jira.myself(credentials);
      if (!account.ok) return { success: false, error: jiraError(account.failure) };
      // Signing in is what the test is for; a token that may not list projects still passes.
      const projects = await jira.projects(credentials);
      return {
        success: true,
        result: { account: account.value, projects: projects.ok ? projects.value : [] },
      };
    },

    connect: async (projectId, input) => {
      if (!(await deps.projectExists(projectId))) return NOT_FOUND;
      const credentials = await credentialsFor(projectId, input.credentials);
      if (!credentials) return { success: false, error: { code: "JIRA_NOT_CONFIGURED" } };
      const account = await jira.myself(credentials);
      if (!account.ok) return { success: false, error: jiraError(account.failure) };
      const refused = await tryFilter(jira, credentials, input.filter);
      if (refused) return { success: false, error: refused };
      const stored: StoredJiraConnection = {
        credentials,
        account: account.value.displayName,
        filter: input.filter,
        linkPullRequests: input.linkPullRequests,
      };
      await jiraStore.write(projectId, stored);
      deps.jiraIssues.forget(projectId);
      return { success: true, connection: publicConnection(stored) };
    },

    disconnect: async (projectId) => {
      if (!(await deps.projectExists(projectId))) return NOT_FOUND;
      await jiraStore.remove(projectId);
      deps.jiraIssues.forget(projectId);
      return { success: true };
    },
  };
};

/** What any client may see of a connection: never the token, nor the email it signs in with. */
export const publicConnection = (stored: StoredJiraConnection | null): JiraConnection =>
  stored
    ? {
        configured: true,
        deployment: stored.credentials.deployment,
        siteUrl: stored.credentials.siteUrl,
        account: stored.account,
        filter: { projects: stored.filter.projects, jql: stored.filter.jql },
        linkPullRequests: stored.linkPullRequests,
      }
    : JIRA_NOT_CONNECTED;

/** Runs the filter for one issue, so a query Jira cannot run is refused before it is kept. */
const tryFilter = async (
  jira: JiraApi,
  credentials: JiraCredentials,
  filter: JiraFilter,
): Promise<IssueError | null> => {
  // Jira refuses a query with nothing but an ORDER BY ("unbounded"); the All tab would send one.
  if (filter.projects.length === 0 && splitOrderBy(filter.jql ?? "").where === "") {
    return { code: "JIRA_BAD_FILTER", message: "Pick a project or give the query a condition" };
  }
  const tried = await jira.searchPage(credentials, {
    jql: jiraListJql(filter, "open"),
    fields: ["summary"],
    maxResults: 1,
    cursor: null,
  });
  if (tried.ok) return null;
  const { failure } = tried;
  return failure.kind === "bad-request"
    ? { code: "JIRA_BAD_FILTER", message: failure.message }
    : jiraError(failure);
};

const jiraError = (failure: JiraFailure): IssueError =>
  failure.kind === "unauthorized"
    ? { code: "JIRA_UNAUTHORIZED" }
    : { code: "SOURCE_FAILED", message: failure.message };
