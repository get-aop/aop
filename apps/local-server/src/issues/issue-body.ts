import type { GithubProjectRepo } from "@aop/common";
import { z } from "zod";
import type { GhRead } from "../github-cli/read.ts";
import type { IssuesGithub } from "./github-issues.ts";
import { GITHUB_ISSUE_BODY_QUERY } from "./github-mapping.ts";
import type { LinearApi } from "./linear-api.ts";
import type { StoredLinearConnection } from "./linear-connection-store.ts";
import type { IssueError } from "./service.ts";

/** An issue read whole, for the brief of a thread started from it. */
export interface IssueWithBody {
  source: "github" | "linear";
  /** `owner/name#12` or `ENG-12`. */
  reference: string;
  title: string;
  url: string;
  body: string;
}

type BodyResult = { success: true; issue: IssueWithBody } | { success: false; error: IssueError };

interface BodySources {
  repos: GithubProjectRepo[];
  github: IssuesGithub;
  linear: LinearApi;
  connection: StoredLinearConnection | null;
}

/**
 * Reads an issue of the project by its list key, fresh from its source: the list does not carry
 * bodies, and the thread should start from what the issue says now. A GitHub key of a repository
 * the project does not hold is not found. A Linear key is read with the project's key, which
 * only sees its own workspace.
 */
export const readIssueBody = async (key: string, sources: BodySources): Promise<BodyResult> => {
  const githubKey = key.match(/^github:([^/#\s]+)\/([^/#\s]+)#(\d+)$/);
  if (githubKey) {
    const [, owner = "", name = "", number = ""] = githubKey;
    return readGithubBody(key, { owner, name, number: Number(number) }, sources);
  }
  const identifier = key.match(/^linear:([A-Za-z0-9]+-\d+)$/)?.[1];
  return identifier ? readLinearBody(key, identifier, sources) : notFound(key);
};

const notFound = (key: string): BodyResult => ({
  success: false,
  error: { code: "ISSUE_NOT_FOUND", key },
});

const readGithubBody = async (
  key: string,
  ref: { owner: string; name: string; number: number },
  { repos, github }: BodySources,
): Promise<BodyResult> => {
  const nameWithOwner = `${ref.owner}/${ref.name}`;
  const inProject = repos.some(
    (repo) => repo.nameWithOwner?.toLowerCase() === nameWithOwner.toLowerCase(),
  );
  if (!inProject) return notFound(key);
  const read = await github.graphql(GITHUB_ISSUE_BODY_QUERY, ref, z.unknown(), {
    key: `issue-body:${nameWithOwner}#${ref.number}`,
    ttlMs: 0,
  });
  const issue = githubIssueOf(read);
  if ("failure" in issue) {
    return { success: false, error: { code: "SOURCE_FAILED", message: issue.failure } };
  }
  if (!issue.found) return notFound(key);
  return {
    success: true,
    issue: { source: "github", reference: `${nameWithOwner}#${ref.number}`, ...issue.found },
  };
};

const readLinearBody = async (
  key: string,
  identifier: string,
  { linear, connection }: BodySources,
): Promise<BodyResult> => {
  if (!connection) return { success: false, error: { code: "LINEAR_NOT_CONFIGURED" } };
  const read = await linear.issueBody(connection.apiKey, identifier);
  if (!read.ok) {
    return {
      success: false,
      error: read.unauthorized
        ? { code: "LINEAR_UNAUTHORIZED" }
        : { code: "SOURCE_FAILED", message: read.message },
    };
  }
  if (!read.value) return notFound(key);
  return { success: true, issue: { source: "linear", reference: identifier, ...read.value } };
};

type GithubBody = { title: string; url: string; body: string };

const githubIssueOf = (
  read: GhRead<unknown>,
): { found: GithubBody | null } | { failure: string } => {
  if (!read.ok) {
    // GitHub answers an unknown issue number with an error, not with a null issue.
    return /Could not resolve to an Issue/i.test(read.message)
      ? { found: null }
      : { failure: read.message };
  }
  const issue = (read.value as { repository?: { issue?: GithubBody | null } | null } | null)
    ?.repository?.issue;
  return { found: issue ? { title: issue.title, url: issue.url, body: issue.body ?? "" } : null };
};
