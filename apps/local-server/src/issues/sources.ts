import type {
  GithubAuth,
  GithubProjectRepo,
  IssueListQuery,
  IssueSourceStatus,
  ProjectIssue,
} from "@aop/common";
import type { GithubService } from "../github/index.ts";
import type { GithubIssueLoader } from "./github-issues.ts";
import { mapGithubIssue } from "./github-mapping.ts";
import type { LinearConnectionStore, StoredLinearConnection } from "./linear-connection-store.ts";
import type { LinearIssueLoader } from "./linear-issues.ts";

/** One source's part of a list: its issues and how it answered. */
export interface SourceRead {
  issues: ProjectIssue[];
  status: IssueSourceStatus;
}

/** The GitHub issues of every repository of the project, one part per repository. */
export const readGithubSources = async (
  repos: GithubProjectRepo[],
  query: IssueListQuery,
  deps: { github: Pick<GithubService, "authStatus">; githubIssues: GithubIssueLoader },
): Promise<SourceRead[]> => {
  const byName = repoIdsByName(repos);
  const auth = repos.length > 0 ? await deps.github.authStatus() : null;
  return Promise.all(
    repos.map(async (repo): Promise<SourceRead> => {
      const { nameWithOwner } = repo;
      if (!nameWithOwner) return { issues: [], status: githubStatus(repo, "no-github-remote") };
      if (!auth?.authenticated) {
        return {
          issues: [],
          status: { ...githubStatus(repo, "not-authenticated"), message: signedOutMessage(auth) },
        };
      }
      const read = await deps.githubIssues.load({ nameWithOwner, ...query });
      return {
        issues: read.nodes.map((node) =>
          mapGithubIssue(node, { repoId: repo.repoId, nameWithOwner }, byName),
        ),
        status: {
          ...githubStatus(repo, githubFailureStatus(read.failure)),
          message: read.failure,
          hasMore: read.hasMore,
          stale: read.failure !== null && read.fetchedAt !== null,
          fetchedAt: isoOrNull(read.fetchedAt),
        },
      };
    }),
  );
};

/** The project's Linear issues, or `not-configured` when no key is connected. */
export const readLinearSource = async (
  projectId: string,
  query: IssueListQuery,
  deps: { linearStore: LinearConnectionStore; linearIssues: LinearIssueLoader },
): Promise<SourceRead> => {
  const connection = await deps.linearStore.read(projectId);
  if (!connection) return { issues: [], status: linearStatus(null, { status: "not-configured" }) };
  const read = await deps.linearIssues.load({ projectId, connection, ...query });
  const { failure } = read;
  return {
    issues: read.issues,
    status: linearStatus(connection, {
      status: failure ? (failure.unauthorized ? "unauthorized" : "error") : "ok",
      message: failure?.message ?? null,
      hasMore: read.hasMore,
      stale: failure !== null && read.fetchedAt !== null,
      fetchedAt: isoOrNull(read.fetchedAt),
    }),
  };
};

// What the person does about it differs: install `gh`, or log it in.
const signedOutMessage = (auth: GithubAuth | null): string | null => {
  if (!auth || auth.authenticated) return null;
  return auth.reason === "gh-missing"
    ? "The GitHub CLI (gh) is not installed on the host."
    : auth.message;
};

/** Whether a failed read failed for want of a login, which the tab explains differently. */
export const isAuthFailure = (message: string): boolean =>
  /gh auth login|HTTP 401|Bad credentials|not logged in/i.test(message);

const githubFailureStatus = (failure: string | null): IssueSourceStatus["status"] => {
  if (failure === null) return "ok";
  return isAuthFailure(failure) ? "not-authenticated" : "error";
};

const repoIdsByName = (repos: GithubProjectRepo[]): Map<string, string> =>
  new Map(
    repos.flatMap((repo) =>
      repo.nameWithOwner ? [[repo.nameWithOwner.toLowerCase(), repo.repoId] as const] : [],
    ),
  );

const githubStatus = (
  repo: GithubProjectRepo,
  status: IssueSourceStatus["status"],
): IssueSourceStatus => ({
  source: "github",
  id: repo.repoId,
  name: repo.nameWithOwner ?? repo.name,
  status,
  message: null,
  hasMore: false,
  stale: false,
  fetchedAt: null,
});

const linearStatus = (
  connection: StoredLinearConnection | null,
  fields: Partial<IssueSourceStatus> & Pick<IssueSourceStatus, "status">,
): IssueSourceStatus => ({
  source: "linear",
  id: "linear",
  name: connection?.scope.name ?? "Linear",
  message: null,
  hasMore: false,
  stale: false,
  fetchedAt: null,
  ...fields,
});

const isoOrNull = (at: number | null): string | null =>
  at === null ? null : new Date(at).toISOString();
