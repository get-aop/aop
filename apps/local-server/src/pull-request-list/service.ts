import type {
  PullRequestListQuery,
  PullRequestListRepo,
  PullRequestListResponse,
  PullRequestListUnavailableReason,
  Thread,
} from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { createKeyedCache, type GithubService, type ProjectGithubRepo } from "../github/index.ts";
import { type GhRead, ghFailure } from "../github-cli/read.ts";
import { pageOf, selectPullRequests } from "./filter.ts";
import { PULL_REQUESTS_QUERY, type PullRequestsPage, PullRequestsPageSchema } from "./graphql.ts";
import { type ListedPullRequest, toListedPullRequest } from "./mapping.ts";

export interface PullRequestListService {
  /** The project's pull requests the query asks for, or null for no such project. */
  list: (projectId: string, query: PullRequestListQuery) => Promise<PullRequestListResponse | null>;
}

export interface PullRequestListDeps {
  github: GithubService;
  threads: Pick<LocalServerContext["threadRepository"], "listByProject">;
  now?: () => number;
}

/** Open pull requests are read whole (up to the cap); closed and merged ones, the latest. */
type Group = "open" | "closed";
const GROUP_STATES: Record<Group, string[]> = { open: ["OPEN"], closed: ["CLOSED", "MERGED"] };
const PAGE_SIZE = 100;
const MAX_PAGES: Record<Group, number> = { open: 5, closed: 3 };

/** A read answers for this long; the dashboard asks about once a minute while the tab shows. */
const FRESH_MS = 30_000;
/**
 * After that, an unchanged list (a 304 to the ETag probe, which costs no rate limit) is reused
 * for up to this long. A check finishing does not change the list, so a read with checks still
 * running is never reused, and no read is reused past this.
 */
const MAX_UNCHANGED_MS = 5 * 60_000;
/** A Refresh this soon after a full read answers from it: a burst of clicks costs one read. */
const MIN_FORCED_INTERVAL_MS = 3_000;

interface Snapshot {
  pulls: ListedPullRequest[];
  truncated: boolean;
  /** The ETag of the repository's most recently updated pull request, as REST answered it. */
  etag: string | null;
  /** When GitHub last answered with the full list, and when it last said it was unchanged. */
  readAt: number;
  checkedAt: number;
}

type GroupRead = { snapshot: Snapshot | null; error: string | null };

export const createPullRequestListService = ({
  github,
  threads,
  now = Date.now,
}: PullRequestListDeps): PullRequestListService => {
  const snapshots = new Map<string, Snapshot>();
  const reads = createKeyedCache(now);

  const readGroup = (repo: GithubRepo, group: Group, refresh: boolean): Promise<GroupRead> => {
    const key = `${repo.nameWithOwner}:${group}`;
    const previous = snapshots.get(key);
    const force = refresh && (!previous || now() - previous.readAt >= MIN_FORCED_INTERVAL_MS);
    return reads.get(
      key,
      async () => {
        const read = await refreshGroup(github, repo, group, previous, force, now);
        if (read.snapshot) snapshots.set(key, read.snapshot);
        return read;
      },
      { ttlMs: FRESH_MS, force, keep: (read) => read.error === null },
    );
  };

  return {
    list: async (projectId, query) => {
      const repos = await github.resolveProjectRepos(projectId);
      if (!repos) return null;
      // A person's Refresh (or Check again) asks gh about its session again too.
      const unavailable = await availability(github, repos, query.refresh);
      if (unavailable) return unavailable;
      const auth = await github.authStatus();
      const viewerLogin = auth.authenticated ? auth.login : "";
      const githubRepos = repos.filter(isOnGithub);
      const groups = groupsFor(query.state);
      const [byRepo, threadOf] = await Promise.all([
        Promise.all(
          githubRepos.map(async (repo) => ({
            repo,
            reads: await Promise.all(groups.map((group) => readGroup(repo, group, query.refresh))),
          })),
        ),
        threadIndex(threads, projectId),
      ]);
      const reads = byRepo.flatMap((entry) => entry.reads);
      const { matching, facets } = selectPullRequests(newestOf(reads), query, viewerLogin);
      const { page, nextCursor } = pageOf(matching, query.cursor, query.limit);
      return {
        status: "ready",
        viewerLogin,
        repos: [
          ...byRepo.map(({ repo, reads }) => repoStatus(repo, reads)),
          ...repos.filter((repo) => !isOnGithub(repo)).map((repo) => repoStatus(repo, [])),
        ],
        items: page.map(({ item }) => ({
          ...item,
          threadId: threadOf.get(`${item.repoId}#${item.number}`) ?? null,
        })),
        total: matching.length,
        nextCursor,
        facets,
        fetchedAt: new Date(oldestCheck(reads) ?? now()).toISOString(),
      };
    },
  };
};

type Connection = NonNullable<PullRequestsPage["repository"]>["pullRequests"];
type GithubRepo = ProjectGithubRepo & { nameWithOwner: string };
const isOnGithub = (repo: ProjectGithubRepo): repo is GithubRepo => repo.nameWithOwner !== null;

const groupsFor = (state: PullRequestListQuery["state"]): Group[] => {
  if (state === "open") return ["open"];
  if (state === "all") return ["open", "closed"];
  return ["closed"];
};

const UNAVAILABLE_MESSAGES: Record<PullRequestListUnavailableReason, string> = {
  "no-repos": "This project has no repositories.",
  "no-github-repos": "None of this project's repositories has a GitHub remote.",
  "gh-missing": "The GitHub CLI (gh) is not installed on the host.",
  "signed-out": "The host's GitHub CLI is not signed in. Sign in on the host, then check again.",
  unreachable: "The host could not reach GitHub.",
};

/** Why the list cannot be read at all: no repository, none on GitHub, or no GitHub session. */
const availability = async (
  github: GithubService,
  repos: ProjectGithubRepo[],
  fresh: boolean,
): Promise<PullRequestListResponse | null> => {
  const reason = await unavailableReason(github, repos, fresh);
  if (!reason) return null;
  return {
    status: "unavailable",
    reason,
    message: UNAVAILABLE_MESSAGES[reason],
    repos: repos.map(({ repoId, name, nameWithOwner }) => ({ repoId, name, nameWithOwner })),
  };
};

const unavailableReason = async (
  github: GithubService,
  repos: ProjectGithubRepo[],
  fresh: boolean,
): Promise<PullRequestListUnavailableReason | null> => {
  if (repos.length === 0) return "no-repos";
  if (!repos.some(isOnGithub)) return "no-github-repos";
  const auth = await github.authStatus({ fresh });
  return auth.authenticated ? null : auth.reason;
};

/**
 * A group's pull requests, as fresh as they need to be: the last read when the ETag probe says
 * nothing changed (and no check was still running), else every page again. A failed read keeps
 * the last good one and says why.
 */
const refreshGroup = async (
  github: GithubService,
  repo: GithubRepo,
  group: Group,
  previous: Snapshot | undefined,
  force: boolean,
  now: () => number,
): Promise<GroupRead> => {
  const probePath = `repos/${repo.nameWithOwner}/pulls?state=all&sort=updated&direction=desc&per_page=1`;
  if (!force && previous && reusable(previous, now())) {
    const probe = await github.restGet(probePath, { etag: previous.etag });
    if (probe.ok && probe.value.notModified) {
      return { snapshot: { ...previous, checkedAt: now() }, error: null };
    }
  }
  const [read, probe] = await Promise.all([
    readAllPages(github, repo, group),
    github.restGet(probePath),
  ]);
  if (!read.ok) return { snapshot: previous ?? null, error: read.message };
  const at = now();
  return {
    snapshot: {
      ...read.value,
      etag: probe.ok ? probe.value.etag : null,
      readAt: at,
      checkedAt: at,
    },
    error: null,
  };
};

const reusable = (snapshot: Snapshot, at: number): boolean =>
  snapshot.etag !== null &&
  at - snapshot.readAt < MAX_UNCHANGED_MS &&
  !snapshot.pulls.some(({ item }) => item.checks?.state === "pending");

type PagesRead =
  | { ok: true; value: { pulls: ListedPullRequest[]; truncated: boolean } }
  | { ok: false; message: string };

const readAllPages = async (
  github: GithubService,
  repo: GithubRepo,
  group: Group,
): Promise<PagesRead> => {
  const pulls: ListedPullRequest[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES[group]; page += 1) {
    const read: GhRead<Connection> = await readPage(github, repo, group, after);
    if (!read.ok) return read;
    pulls.push(
      ...read.value.nodes.flatMap((node) => (node ? [toListedPullRequest(repo, node)] : [])),
    );
    if (!read.value.pageInfo.hasNextPage) return { ok: true, value: { pulls, truncated: false } };
    after = read.value.pageInfo.endCursor ?? null;
  }
  return { ok: true, value: { pulls, truncated: true } };
};

const readPage = async (
  github: GithubService,
  repo: GithubRepo,
  group: Group,
  after: string | null,
): Promise<GhRead<Connection>> => {
  const [owner, name] = repo.nameWithOwner.split("/") as [string, string];
  const read = await github.graphql(
    PULL_REQUESTS_QUERY,
    { owner, name, states: GROUP_STATES[group], first: PAGE_SIZE, after },
    PullRequestsPageSchema,
    // Pages are kept by the snapshot; the key only lets simultaneous reads share a request.
    { key: `pulls:${repo.nameWithOwner}:${group}:${after ?? ""}`, ttlMs: 0 },
  );
  if (!read.ok) return read;
  const connection = read.value.repository?.pullRequests;
  return connection
    ? { ok: true, value: connection }
    : ghFailure(`GitHub has no repository ${repo.nameWithOwner} for this account`);
};

/**
 * Every pull request of the reads once: one that closed between the reads of its two groups is
 * in both, and the newer copy wins.
 */
const newestOf = (reads: readonly GroupRead[]): ListedPullRequest[] => {
  const byKey = new Map<string, ListedPullRequest>();
  for (const pull of reads.flatMap((read) => read.snapshot?.pulls ?? [])) {
    const key = `${pull.item.repoId}#${pull.item.number}`;
    const seen = byKey.get(key);
    if (!seen || Date.parse(pull.item.updatedAt) > Date.parse(seen.item.updatedAt)) {
      byKey.set(key, pull);
    }
  }
  return [...byKey.values()];
};

const repoStatus = (repo: ProjectGithubRepo, reads: readonly GroupRead[]): PullRequestListRepo => ({
  repoId: repo.repoId,
  name: repo.name,
  nameWithOwner: repo.nameWithOwner,
  error: reads.find((read) => read.error)?.error ?? null,
  truncated: reads.some((read) => read.snapshot?.truncated),
});

const oldestCheck = (reads: readonly GroupRead[]): number | null => {
  const times = reads.flatMap((read) => (read.snapshot ? [read.snapshot.checkedAt] : []));
  return times.length > 0 ? Math.min(...times) : null;
};

/** `repoId#number` of each thread's pull request, to the thread. */
const threadIndex = async (
  threads: PullRequestListDeps["threads"],
  projectId: string,
): Promise<Map<string, string>> => {
  const index = new Map<string, string>();
  for (const thread of (await threads.listByProject(projectId)) as Thread[]) {
    const pr = thread.artifacts.find((artifact) => artifact.type === "pr");
    if (thread.repoId && pr?.type === "pr") index.set(`${thread.repoId}#${pr.number}`, thread.id);
  }
  return index;
};
