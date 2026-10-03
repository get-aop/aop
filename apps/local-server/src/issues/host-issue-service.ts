import type { GithubService } from "../github/index.ts";
import type { ProjectService } from "../project/service.ts";
import { createGithubIssueLoader } from "./github-issues.ts";
import { createJiraApi, type JiraFetch } from "./jira/jira-api.ts";
import { createJiraConnectionStore } from "./jira/jira-connection-store.ts";
import { createJiraIssueLoader } from "./jira/jira-issues.ts";
import { createLinearApi, type LinearFetch } from "./linear-api.ts";
import { createLinearConnectionStore } from "./linear-connection-store.ts";
import { createLinearIssueLoader } from "./linear-issues.ts";
import { createIssueService, type IssueService } from "./service.ts";

/** The issues service over the host's shared GitHub service, Linear and Jira; tests swap the seams. */
export const createHostIssueService = (
  projects: Pick<ProjectService, "sendToCoordinator">,
  github: GithubService,
  seams: { linearFetch?: LinearFetch; jiraFetch?: JiraFetch } = {},
): IssueService => {
  const linear = createLinearApi({ fetch: seams.linearFetch });
  const jira = createJiraApi({ fetch: seams.jiraFetch });
  return createIssueService({
    sendToCoordinator: (projectId, text) => projects.sendToCoordinator(projectId, text),
    github,
    githubIssues: createGithubIssueLoader(github),
    linear,
    linearIssues: createLinearIssueLoader(linear),
    linearStore: createLinearConnectionStore(),
    jira,
    jiraIssues: createJiraIssueLoader(jira),
    jiraStore: createJiraConnectionStore(),
  });
};
