import type { GithubProjectRepo, IssueComment, IssueDetail } from "@aop/common";
import { z } from "zod";
import type { GhRead } from "../github-cli/read.ts";
import type { IssuesGithub } from "./github-issues.ts";
import {
  GITHUB_ISSUE_DETAIL_QUERY,
  type GithubActor,
  type GithubIssueNode,
  githubPerson,
  mapGithubIssue,
} from "./github-mapping.ts";
import type { JiraApi } from "./jira/jira-api.ts";
import type { StoredJiraConnection } from "./jira/jira-connection-store.ts";
import { readJiraDetail } from "./jira/jira-detail.ts";
import type { LinearApi } from "./linear-api.ts";
import type { StoredLinearConnection } from "./linear-connection-store.ts";
import type { IssueError } from "./service.ts";

export type DetailResult =
  | { success: true; detail: IssueDetail }
  | { success: false; error: IssueError };

export interface DetailSources {
  repos: GithubProjectRepo[];
  github: IssuesGithub;
  linear: LinearApi;
  linearConnection: StoredLinearConnection | null;
  jira: JiraApi;
  jiraConnection: StoredJiraConnection | null;
}

/**
 * Reads an issue of the project by its list key, fresh from its source: the list does not carry
 * bodies or comments, and a thread should start from what the issue says now. A GitHub key of a
 * repository the project does not hold is not found. A Linear or Jira key is read with the
 * project's own connection, which only sees its own workspace or site.
 */
export const readIssueDetail = async (
  key: string,
  sources: DetailSources,
): Promise<DetailResult> => {
  const githubKey = key.match(/^github:([^/#\s]+)\/([^/#\s]+)#(\d+)$/);
  if (githubKey) {
    const [, owner = "", name = "", number = ""] = githubKey;
    return readGithubDetail(key, { owner, name, number: Number(number) }, sources);
  }
  const linearKey = key.match(/^linear:([A-Za-z0-9]+-\d+)$/)?.[1];
  if (linearKey) return readLinearDetail(key, linearKey, sources);
  const jiraKey = key.match(/^jira:([A-Za-z][A-Za-z0-9_]*-\d+)$/)?.[1];
  return jiraKey ? readJiraIssue(key, jiraKey, sources) : notFound(key);
};

const notFound = (key: string): DetailResult => ({
  success: false,
  error: { code: "ISSUE_NOT_FOUND", key },
});

const failedWith = (message: string): DetailResult => ({
  success: false,
  error: { code: "SOURCE_FAILED", message },
});

const readGithubDetail = async (
  key: string,
  ref: { owner: string; name: string; number: number },
  { repos, github }: DetailSources,
): Promise<DetailResult> => {
  const nameWithOwner = `${ref.owner}/${ref.name}`;
  const repo = repos.find(
    (candidate) => candidate.nameWithOwner?.toLowerCase() === nameWithOwner.toLowerCase(),
  );
  if (!repo?.nameWithOwner) return notFound(key);
  const read = await github.graphql(GITHUB_ISSUE_DETAIL_QUERY, ref, z.unknown(), {
    key: `issue-detail:${nameWithOwner}#${ref.number}`,
    ttlMs: 0,
  });
  const found = githubIssueOf(read);
  if ("failure" in found) return failedWith(found.failure);
  if (!found.issue) return notFound(key);
  const byName = new Map(
    repos.flatMap((item) =>
      item.nameWithOwner ? [[item.nameWithOwner.toLowerCase(), item.repoId] as const] : [],
    ),
  );
  const { issue } = found;
  const comments = (issue.recentComments?.nodes ?? []).flatMap((comment) =>
    comment ? [githubComment(comment)] : [],
  );
  return {
    success: true,
    detail: {
      issue: mapGithubIssue(
        issue,
        { repoId: repo.repoId, nameWithOwner: repo.nameWithOwner },
        byName,
      ),
      body: issue.body ?? "",
      sections: [],
      comments,
      commentCount: Math.max(issue.comments?.totalCount ?? 0, comments.length),
    },
  };
};

const readLinearDetail = async (
  key: string,
  identifier: string,
  { linear, linearConnection }: DetailSources,
): Promise<DetailResult> => {
  if (!linearConnection) return { success: false, error: { code: "LINEAR_NOT_CONFIGURED" } };
  const read = await linear.issueDetail(linearConnection.apiKey, {
    identifier,
    scope: linearConnection.scope,
  });
  if (!read.ok) {
    return read.unauthorized
      ? { success: false, error: { code: "LINEAR_UNAUTHORIZED" } }
      : failedWith(read.message);
  }
  if (!read.value) return notFound(key);
  const { issue, body, comments } = read.value;
  return {
    success: true,
    detail: {
      issue,
      body,
      sections: [],
      comments,
      commentCount: Math.max(issue.commentCount ?? 0, comments.length),
    },
  };
};

const readJiraIssue = async (
  key: string,
  issueKey: string,
  { jira, jiraConnection }: DetailSources,
): Promise<DetailResult> => {
  if (!jiraConnection) return { success: false, error: { code: "JIRA_NOT_CONFIGURED" } };
  const read = await readJiraDetail(jira, jiraConnection, issueKey);
  if (!read.ok) {
    return read.failure.kind === "unauthorized"
      ? { success: false, error: { code: "JIRA_UNAUTHORIZED" } }
      : failedWith(read.failure.message);
  }
  return read.value ? { success: true, detail: read.value } : notFound(key);
};

interface GithubDetailNode extends GithubIssueNode {
  body?: string | null;
  recentComments?: {
    nodes?: ({ id: string; body: string; createdAt: string; author: GithubActor | null } | null)[];
  };
}

const githubIssueOf = (
  read: GhRead<unknown>,
): { issue: GithubDetailNode | null } | { failure: string } => {
  if (!read.ok) {
    // GitHub answers an unknown issue number with an error, not with a null issue.
    return /Could not resolve to an Issue/i.test(read.message)
      ? { issue: null }
      : { failure: read.message };
  }
  const issue = (read.value as { repository?: { issue?: GithubDetailNode | null } | null } | null)
    ?.repository?.issue;
  return { issue: issue ?? null };
};

const githubComment = (comment: {
  id: string;
  body: string;
  createdAt: string;
  author: GithubActor | null;
}): IssueComment => ({
  id: comment.id,
  author: comment.author ? githubPerson(comment.author) : null,
  body: comment.body,
  createdAt: comment.createdAt,
});
