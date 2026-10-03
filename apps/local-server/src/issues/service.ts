import type {
  GithubProjectRepo,
  IssueDetail,
  IssueList,
  IssueListQuery,
  LinearCatalog,
  LinearCatalogInput,
  LinearConnectInput,
  LinearConnection,
  Message,
  ProjectIssue,
} from "@aop/common";
import type { GithubService } from "../github/index.ts";
import type { ProjectError } from "../project/service.ts";
import type { GithubIssueLoader } from "./github-issues.ts";
import { issueBrief } from "./issue-brief.ts";
import { readIssueDetail } from "./issue-detail.ts";
import type { JiraApi } from "./jira/jira-api.ts";
import {
  createJiraConnectionService,
  type JiraConnectionService,
} from "./jira/jira-connection-service.ts";
import type { JiraConnectionStore } from "./jira/jira-connection-store.ts";
import type { JiraIssueLoader } from "./jira/jira-issues.ts";
import type { LinearApi } from "./linear-api.ts";
import type { LinearConnectionStore, StoredLinearConnection } from "./linear-connection-store.ts";
import type { LinearIssueLoader } from "./linear-issues.ts";
import { readGithubSources, readJiraSource, readLinearSource } from "./sources.ts";

export type IssueError =
  | { code: "PROJECT_NOT_FOUND" }
  | { code: "ISSUE_NOT_FOUND"; key: string }
  | { code: "LINEAR_NOT_CONFIGURED" }
  | { code: "LINEAR_UNAUTHORIZED" }
  | { code: "JIRA_NOT_CONFIGURED" }
  | { code: "JIRA_UNAUTHORIZED" }
  | { code: "JIRA_BAD_FILTER"; message: string }
  | { code: "SOURCE_FAILED"; message: string }
  | { code: "PROJECT_ERROR"; error: ProjectError };

export type IssueResult<T> = ({ success: true } & T) | { success: false; error: IssueError };

export interface IssueService {
  list: (projectId: string, query: IssueListQuery) => Promise<IssueResult<{ list: IssueList }>>;
  /**
   * Asks the project's coordinator to start a thread for an issue, with the issue's title, body
   * and link as the brief: the same message the person could type, so the coordinator picks the
   * repository and writes the thread's prompt as it always does.
   */
  startThread: (projectId: string, key: string) => Promise<IssueResult<{ message: Message }>>;
  /** One issue whole, read fresh from its source, for the issue view. */
  detail: (projectId: string, key: string) => Promise<IssueResult<{ detail: IssueDetail }>>;
  linearConnection: (projectId: string) => Promise<IssueResult<{ connection: LinearConnection }>>;
  /** Host owner only (auth/route-policy.ts). Checks the key with Linear before keeping it. */
  connectLinear: (
    projectId: string,
    input: LinearConnectInput,
  ) => Promise<IssueResult<{ connection: LinearConnection }>>;
  disconnectLinear: (projectId: string) => Promise<IssueResult<Record<never, never>>>;
  /** Host owner only: the teams and projects a key (or the stored one) can see, to map one. */
  linearCatalog: (
    projectId: string,
    input: LinearCatalogInput,
  ) => Promise<IssueResult<{ catalog: LinearCatalog }>>;
  /** The project's Jira connection: reading it, testing, setting and removing it. */
  jiraConnection: JiraConnectionService;
}

export interface IssueServiceDeps {
  sendToCoordinator: (
    projectId: string,
    text: string,
  ) => Promise<{ success: true; message: Message } | { success: false; error: ProjectError }>;
  github: Pick<GithubService, "authStatus" | "resolveProjectRepos" | "graphql" | "restGet">;
  githubIssues: GithubIssueLoader;
  linear: LinearApi;
  linearIssues: LinearIssueLoader;
  linearStore: LinearConnectionStore;
  jira: JiraApi;
  jiraIssues: JiraIssueLoader;
  jiraStore: JiraConnectionStore;
}

export const createIssueService = (deps: IssueServiceDeps): IssueService => {
  const { github, linear, linearStore } = deps;
  const projectRepos = (projectId: string) => github.resolveProjectRepos(projectId);

  const findIssue = async (projectId: string, repos: GithubProjectRepo[], key: string) =>
    readIssueDetail(key, {
      repos,
      github,
      linear,
      linearConnection: await linearStore.read(projectId),
      jira: deps.jira,
      jiraConnection: await deps.jiraStore.read(projectId),
    });

  return {
    jiraConnection: createJiraConnectionService({
      projectExists: async (projectId) => (await projectRepos(projectId)) !== null,
      jira: deps.jira,
      jiraIssues: deps.jiraIssues,
      jiraStore: deps.jiraStore,
    }),

    list: async (projectId, query) => {
      const repos = await projectRepos(projectId);
      if (!repos) return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      const [githubParts, linearPart, jiraPart] = await Promise.all([
        readGithubSources(repos, query, deps),
        readLinearSource(projectId, query, deps),
        readJiraSource(projectId, query, deps),
      ]);
      const parts = [...githubParts, linearPart, jiraPart];
      const issues: ProjectIssue[] = parts
        .flatMap((part) => part.issues)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { success: true, list: { issues, sources: parts.map((part) => part.status) } };
    },

    startThread: async (projectId, key) => {
      const repos = await projectRepos(projectId);
      if (!repos) return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      const found = await findIssue(projectId, repos, key);
      if (!found.success) return found;
      const keyInPullRequest = (await deps.jiraStore.read(projectId))?.linkPullRequests === true;
      const brief = issueBrief(found.detail, { keyInPullRequest });
      const sent = await deps.sendToCoordinator(projectId, brief);
      return sent.success
        ? { success: true, message: sent.message }
        : { success: false, error: { code: "PROJECT_ERROR", error: sent.error } };
    },

    detail: async (projectId, key) => {
      const repos = await projectRepos(projectId);
      if (!repos) return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      const found = await findIssue(projectId, repos, key);
      return found.success ? { success: true, detail: found.detail } : found;
    },

    linearConnection: async (projectId) => {
      if (!(await projectRepos(projectId)))
        return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      return { success: true, connection: publicConnection(await linearStore.read(projectId)) };
    },

    connectLinear: async (projectId, input) => {
      if (!(await projectRepos(projectId)))
        return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      const apiKey = input.apiKey ?? (await linearStore.read(projectId))?.apiKey;
      if (!apiKey) return { success: false, error: { code: "LINEAR_NOT_CONFIGURED" } };
      const catalog = await linear.catalog(apiKey);
      if (!catalog.ok) return { success: false, error: linearError(catalog) };
      const stored = {
        apiKey,
        scope: input.scope,
        workspace: catalog.value.workspace,
        viewer: catalog.value.viewer,
      };
      await linearStore.write(projectId, stored);
      deps.linearIssues.forget(projectId);
      return { success: true, connection: publicConnection(stored) };
    },

    disconnectLinear: async (projectId) => {
      if (!(await projectRepos(projectId)))
        return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      await linearStore.remove(projectId);
      deps.linearIssues.forget(projectId);
      return { success: true };
    },

    linearCatalog: async (projectId, input) => {
      if (!(await projectRepos(projectId)))
        return { success: false, error: { code: "PROJECT_NOT_FOUND" } };
      const apiKey = input.apiKey ?? (await linearStore.read(projectId))?.apiKey;
      if (!apiKey) return { success: false, error: { code: "LINEAR_NOT_CONFIGURED" } };
      const catalog = await linear.catalog(apiKey);
      return catalog.ok
        ? { success: true, catalog: catalog.value }
        : { success: false, error: linearError(catalog) };
    },
  };
};

/** What any client may see of a connection: never the key. */
const publicConnection = (stored: StoredLinearConnection | null): LinearConnection =>
  stored
    ? { configured: true, scope: stored.scope, workspace: stored.workspace, viewer: stored.viewer }
    : { configured: false, scope: null, workspace: null, viewer: null };

const linearError = (read: { unauthorized: boolean; message: string }): IssueError =>
  read.unauthorized
    ? { code: "LINEAR_UNAUTHORIZED" }
    : { code: "SOURCE_FAILED", message: read.message };
