import type { IssueStateFilter, ProjectIssue } from "@aop/common";
import type { JiraApi, JiraFailure } from "./jira-api.ts";
import type { StoredJiraConnection } from "./jira-connection-store.ts";
import { jiraListJql } from "./jira-jql.ts";
import { JIRA_LIST_FIELDS, mapJiraIssue } from "./jira-mapping.ts";

export interface JiraIssues {
  issues: ProjectIssue[];
  hasMore: boolean;
  fetchedAt: number | null;
  /** Null when current; else why the last read failed (the issues may be older ones). */
  failure: JiraFailure | null;
}

export interface JiraIssueLoader {
  load: (request: {
    projectId: string;
    connection: StoredJiraConnection;
    state: IssueStateFilter;
    limit: number;
    refresh: boolean;
  }) => Promise<JiraIssues>;
  /** Drops what is held for a project, when its connection changes. */
  forget: (projectId: string) => void;
}

/**
 * Reads a project's Jira issues and keeps them a minute, as the Linear source does: Jira has no
 * conditional search, so an explicit refresh reads again, and two requests for the same list
 * share one read. When Jira answers 429 with a long Retry-After, nothing is asked of it until
 * that time has passed, Refresh included: the held issues are served with the reason.
 */
export const createJiraIssueLoader = (
  api: JiraApi,
  options: { now?: () => number; reuseMs?: number } = {},
): JiraIssueLoader => {
  const now = options.now ?? Date.now;
  const reuseMs = options.reuseMs ?? 60_000;
  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<JiraIssues>>();
  const quietUntil = new Map<string, { at: number; failure: JiraFailure }>();

  const read = async (
    key: string,
    projectId: string,
    connection: StoredJiraConnection,
    state: IssueStateFilter,
    limit: number,
  ): Promise<JiraIssues> => {
    const pages = await readPages(api, connection, state, limit);
    if ("failure" in pages) {
      const { retryAfterMs } = pages.failure;
      if (retryAfterMs !== undefined) {
        quietUntil.set(projectId, { at: now() + retryAfterMs, failure: pages.failure });
      }
      return failed(entries.get(key), limit, pages.failure);
    }
    const entry: Entry = { ...pages, fetchedAt: now(), fingerprint: fingerprint(connection) };
    entries.set(key, entry);
    return served(entry, limit);
  };

  return {
    load: async ({ projectId, connection, state, limit, refresh }) => {
      const key = `${projectId}|${state}`;
      const held = entries.get(key);
      const current = held?.fingerprint === fingerprint(connection) ? held : undefined;
      const quiet = quietUntil.get(projectId);
      if (quiet && quiet.at > now()) return failed(current, limit, quiet.failure);
      if (current && !refresh && isFresh(current, limit, now() - reuseMs)) {
        return served(current, limit);
      }
      const running = inFlight.get(key);
      if (running) return running;
      const loading = read(key, projectId, connection, state, limit).finally(() =>
        inFlight.delete(key),
      );
      inFlight.set(key, loading);
      return loading;
    },
    forget: (projectId) => {
      quietUntil.delete(projectId);
      for (const key of entries.keys()) {
        if (key.startsWith(`${projectId}|`)) entries.delete(key);
      }
    },
  };
};

// Jira's search pages hold at most 100 issues with fields.
const JIRA_PAGE_SIZE = 100;

type PagesRead = { issues: ProjectIssue[]; next: string | null } | { failure: JiraFailure };

/** Pages from the start until `limit` issues are read or there are no more. */
const readPages = async (
  api: JiraApi,
  connection: StoredJiraConnection,
  state: IssueStateFilter,
  limit: number,
): Promise<PagesRead> => {
  const { credentials } = connection;
  const jql = jiraListJql(connection.filter, state);
  const issues: ProjectIssue[] = [];
  let cursor: string | null = null;
  do {
    const page = await api.searchPage(credentials, {
      jql,
      fields: JIRA_LIST_FIELDS,
      maxResults: JIRA_PAGE_SIZE,
      cursor,
    });
    if (!page.ok) return { failure: page.failure };
    issues.push(...page.value.issues.map((node) => mapJiraIssue(node, credentials)));
    cursor = page.value.next;
  } while (cursor !== null && issues.length < limit);
  return { issues, next: cursor };
};

interface Entry {
  issues: ProjectIssue[];
  next: string | null;
  fetchedAt: number;
  /** Which site, account and filter the issues were read for; a change reads again. */
  fingerprint: string;
}

const fingerprint = ({ credentials, filter }: StoredJiraConnection): string =>
  JSON.stringify([credentials.deployment, credentials.siteUrl, filter.projects, filter.jql]);

/** Read within the reuse window, and holding as many issues as asked for (or all there are). */
const isFresh = (entry: Entry, limit: number, since: number): boolean =>
  entry.fetchedAt > since && (entry.issues.length >= limit || entry.next === null);

const served = (entry: Entry, limit: number): JiraIssues => ({
  issues: entry.issues.slice(0, limit),
  hasMore: entry.issues.length > limit || entry.next !== null,
  fetchedAt: entry.fetchedAt,
  failure: null,
});

const failed = (entry: Entry | undefined, limit: number, failure: JiraFailure): JiraIssues => ({
  ...(entry ? served(entry, limit) : { issues: [], hasMore: false, fetchedAt: null }),
  failure,
});
