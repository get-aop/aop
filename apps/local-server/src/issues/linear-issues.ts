import type { IssueStateFilter, ProjectIssue } from "@aop/common";
import type { LinearApi } from "./linear-api.ts";
import type { StoredLinearConnection } from "./linear-connection-store.ts";

export interface LinearIssues {
  issues: ProjectIssue[];
  hasMore: boolean;
  fetchedAt: number | null;
  /** Null when current; else why the last read failed (the issues may be older ones). */
  failure: { unauthorized: boolean; message: string } | null;
}

export interface LinearIssueLoader {
  load: (request: {
    projectId: string;
    connection: StoredLinearConnection;
    state: IssueStateFilter;
    limit: number;
    refresh: boolean;
  }) => Promise<LinearIssues>;
  /** Drops what is held for a project, when its connection changes. */
  forget: (projectId: string) => void;
}

/**
 * Reads a project's Linear issues and keeps them a minute. Linear has no conditional requests,
 * so an explicit refresh reads again; the tab's background refresh is spaced past the reuse
 * window, which keeps a visible tab within Linear's request budget. Two requests for the same
 * list share one read.
 */
export const createLinearIssueLoader = (
  api: LinearApi,
  options: { now?: () => number; reuseMs?: number } = {},
): LinearIssueLoader => {
  const now = options.now ?? Date.now;
  const reuseMs = options.reuseMs ?? 60_000;
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<LinearIssues>>();

  const read = async (
    key: string,
    connection: StoredLinearConnection,
    state: IssueStateFilter,
    limit: number,
  ): Promise<LinearIssues> => {
    const held = entries.get(key);
    const pages = await readPages(api, connection, state, limit);
    if ("failure" in pages) {
      return {
        ...(held ? served(held, limit) : { issues: [], hasMore: false, fetchedAt: null }),
        failure: pages.failure,
      };
    }
    const entry: Entry = { ...pages, fetchedAt: now(), fingerprint: fingerprint(connection) };
    entries.set(key, entry);
    return served(entry, limit);
  };

  return {
    load: async ({ projectId, connection, state, limit, refresh }) => {
      const key = `${projectId}|${state}`;
      const held = entries.get(key);
      const fresh =
        held &&
        held.fingerprint === fingerprint(connection) &&
        now() - held.fetchedAt < reuseMs &&
        (held.issues.length >= limit || !held.hasNextPage);
      if (fresh && !refresh) return served(held, limit);
      const running = inFlight.get(key);
      if (running) return running;
      const loading = read(key, connection, state, limit).finally(() => inFlight.delete(key));
      inFlight.set(key, loading);
      return loading;
    },
    forget: (projectId) => {
      for (const key of entries.keys()) {
        if (key.startsWith(`${projectId}|`)) entries.delete(key);
      }
    },
  };
};

// Each issue asks for up to 50 comment ids; 50 issues a page keeps a query within Linear's
// complexity limit.
const LINEAR_PAGE_SIZE = 50;

type PagesRead =
  | { issues: ProjectIssue[]; hasNextPage: boolean }
  | { failure: { unauthorized: boolean; message: string } };

/** Pages from the start until `limit` issues are read or there are no more. */
const readPages = async (
  api: LinearApi,
  connection: StoredLinearConnection,
  state: IssueStateFilter,
  limit: number,
): Promise<PagesRead> => {
  const issues: ProjectIssue[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  while (hasNextPage && issues.length < limit) {
    const page = await api.issuePage(connection.apiKey, {
      scope: connection.scope,
      state,
      first: LINEAR_PAGE_SIZE,
      after,
    });
    if (!page.ok) return { failure: { unauthorized: page.unauthorized, message: page.message } };
    issues.push(...page.value.issues);
    hasNextPage = page.value.hasNextPage;
    after = page.value.endCursor;
  }
  return { issues, hasNextPage };
};

interface Entry {
  issues: ProjectIssue[];
  hasNextPage: boolean;
  fetchedAt: number;
  /** Which mapping the issues were read for; a changed scope reads again. */
  fingerprint: string;
}

const fingerprint = (connection: StoredLinearConnection): string =>
  `${connection.scope.kind}:${connection.scope.id}`;

const served = (entry: Entry, limit: number): LinearIssues => ({
  issues: entry.issues.slice(0, limit),
  hasMore: entry.issues.length > limit || entry.hasNextPage,
  fetchedAt: entry.fetchedAt,
  failure: null,
});
