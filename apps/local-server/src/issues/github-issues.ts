import { ISSUE_PAGE_SIZE, type IssueStateFilter } from "@aop/common";
import { z } from "zod";
import type { GithubService } from "../github/index.ts";
import { type GithubIssueNode, githubIssuesQuery, parseGithubIssuePage } from "./github-mapping.ts";

/** What one repository's issues read gave: the issues held, and why the last read failed if it did. */
export interface GithubRepoIssues {
  nodes: GithubIssueNode[];
  hasMore: boolean;
  fetchedAt: number | null;
  /** Null when the issues are current; else why they could not be read (they may be older ones). */
  failure: string | null;
}

/** The GitHub reads the issues domain makes, from the host's shared GitHub service. */
export type IssuesGithub = Pick<GithubService, "graphql" | "restGet">;

export interface GithubIssueLoader {
  load: (request: {
    nameWithOwner: string;
    state: IssueStateFilter;
    limit: number;
    refresh: boolean;
  }) => Promise<GithubRepoIssues>;
}

export interface GithubIssueLoaderOptions {
  now?: () => number;
  /** How long a read is reused without asking GitHub at all. */
  reuseMs?: number;
  /**
   * How long an unchanged answer to the probe is trusted. A check run finishing does not touch an
   * issue or a pull request, so past this the issues are read again to pick up their checks.
   */
  maxAgeMs?: number;
}

/**
 * Reads repositories' issues and keeps them, per repository and state filter, so the tab's
 * background refresh costs GitHub nearly nothing. Before reading again it probes the most
 * recently updated issue or pull request of the repository with the ETag of the last probe: a
 * 304 means nothing changed (and is not counted against the rate limit), so the held issues are
 * served. Two requests for the same list share one read.
 */
export const createGithubIssueLoader = (
  github: IssuesGithub,
  options: GithubIssueLoaderOptions = {},
): GithubIssueLoader => {
  const now = options.now ?? Date.now;
  const reuseMs = options.reuseMs ?? 15_000;
  const maxAgeMs = options.maxAgeMs ?? 5 * 60_000;
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<GithubRepoIssues>>();

  const refreshEntry = async (
    key: string,
    nameWithOwner: string,
    state: IssueStateFilter,
    limit: number,
  ): Promise<GithubRepoIssues> => {
    const held = entries.get(key);
    const probe = await github.restGet(probePath(nameWithOwner), { etag: held?.etag ?? null });
    if (!probe.ok) return failed(held, probe.message);
    const base = reusable(held, probe.value.notModified);
    const want = Math.max(limit, base ? 0 : (held?.nodes.length ?? 0));
    const read = await readPages(github, nameWithOwner, state, want, base);
    if ("failure" in read) return failed(held, read.failure);
    const entry: Entry = {
      ...read,
      etag: probe.value.etag ?? held?.etag ?? null,
      checkedAt: now(),
      fetchedAt: base?.fetchedAt ?? now(),
    };
    entries.set(key, entry);
    return served(entry, limit);
  };

  // Unchanged: keep what is held and only page on if more is asked for. Changed (or held too
  // long): read again from the top, as many issues as were held.
  const reusable = (held: Entry | undefined, notModified: boolean): Entry | null =>
    held && notModified && now() - held.fetchedAt < maxAgeMs ? held : null;

  return {
    load: async ({ nameWithOwner, state, limit, refresh }) => {
      const key = `${nameWithOwner.toLowerCase()}|${state}`;
      const held = entries.get(key);
      if (held && !refresh && now() - held.checkedAt < reuseMs && covers(held, limit)) {
        return served(held, limit);
      }
      const running = inFlight.get(key);
      if (running) return running;
      const read = refreshEntry(key, nameWithOwner, state, limit).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, read);
      return read;
    },
  };
};

interface Entry {
  /** The ETag of the last probe. */
  etag: string | null;
  checkedAt: number;
  fetchedAt: number;
  nodes: GithubIssueNode[];
  hasNextPage: boolean;
  endCursor: string | null;
}

// Issues and pull requests share one list, so it changes when either does: a linked pull
// request merging moves it too.
const probePath = (nameWithOwner: string): string =>
  `repos/${nameWithOwner}/issues?state=all&sort=updated&direction=desc&per_page=1`;

const covers = (entry: Entry, limit: number): boolean =>
  entry.nodes.length >= limit || !entry.hasNextPage;

const served = (entry: Entry, limit: number): GithubRepoIssues => ({
  nodes: entry.nodes.slice(0, limit),
  hasMore: entry.nodes.length > limit || entry.hasNextPage,
  fetchedAt: entry.fetchedAt,
  failure: null,
});

const failed = (held: Entry | undefined, failure: string): GithubRepoIssues => ({
  nodes: held?.nodes ?? [],
  hasMore: held?.hasNextPage ?? false,
  fetchedAt: held?.fetchedAt ?? null,
  failure,
});

type PagesRead =
  | {
      nodes: GithubIssueNode[];
      hasNextPage: boolean;
      endCursor: string | null;
    }
  | { failure: string };

/** Pages on from `base` (or from the start) until `want` issues are held or there are no more. */
const readPages = async (
  github: IssuesGithub,
  nameWithOwner: string,
  state: IssueStateFilter,
  want: number,
  base: Entry | null,
): Promise<PagesRead> => {
  const [owner = "", name = ""] = nameWithOwner.split("/");
  const nodes = base ? [...base.nodes] : [];
  let hasNextPage = base ? base.hasNextPage : true;
  let endCursor = base?.endCursor ?? null;
  while (hasNextPage && nodes.length < want) {
    // This loader keeps its own pages, so the shared cache only joins identical reads in flight.
    const read = await github.graphql(
      githubIssuesQuery(state),
      { owner, name, first: ISSUE_PAGE_SIZE, after: endCursor },
      z.unknown(),
      { key: `issues:${nameWithOwner}:${state}:${endCursor ?? ""}`, ttlMs: 0 },
    );
    if (!read.ok) return { failure: read.message };
    const page = parseGithubIssuePage(read.value);
    if (!page) return { failure: `GitHub has no repository ${nameWithOwner} this login can read` };
    nodes.push(...page.issues);
    hasNextPage = page.hasNextPage;
    endCursor = page.endCursor;
  }
  return { nodes, hasNextPage, endCursor };
};
