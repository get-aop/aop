import {
  PULL_REQUEST_LIST_SORTS,
  PULL_REQUEST_LIST_STATES,
  type PullRequestListSort,
  type PullRequestListState,
} from "@aop/common";
import { useCallback, useMemo } from "react";
import { useLocalStorage } from "../../hooks/use-local-storage";

/** What narrows the Pull requests tab. Kept per project on this device, like the open tabs. */
export interface PullRequestFilters {
  state: PullRequestListState;
  author: string[];
  label: string[];
  assignee: string[];
  q: string;
  sort: PullRequestListSort;
  involves: boolean;
}

export type FacetKey = "author" | "label" | "assignee";

export const DEFAULT_PULL_REQUEST_FILTERS: PullRequestFilters = {
  state: "open",
  author: [],
  label: [],
  assignee: [],
  q: "",
  sort: "updated",
  involves: false,
};

export const SORT_LABEL: Record<PullRequestListSort, string> = {
  updated: "Recently updated",
  "least-updated": "Least recently updated",
  newest: "Newest",
  oldest: "Oldest",
  "most-commented": "Most commented",
  "least-commented": "Least commented",
};

/** How many filters beyond the state narrow the list (the search counts as one). */
export const activeFilterCount = (filters: PullRequestFilters): number =>
  filters.author.length +
  filters.label.length +
  filters.assignee.length +
  (filters.q.trim() ? 1 : 0) +
  (filters.involves ? 1 : 0);

export interface PullRequestFilterControls {
  filters: PullRequestFilters;
  set: <K extends keyof PullRequestFilters>(key: K, value: PullRequestFilters[K]) => void;
  toggle: (key: FacetKey, value: string) => void;
  /** Drops every filter but the state and the sort. */
  clear: () => void;
}

const storageKey = (projectId: string) => `aop:pull-request-filters:v1:${projectId}`;

export const usePullRequestFilters = (projectId: string): PullRequestFilterControls => {
  const [stored, setStored] = useLocalStorage<unknown>(storageKey(projectId), null);
  const filters = useMemo(() => readFilters(stored), [stored]);

  const set = useCallback<PullRequestFilterControls["set"]>(
    (key, value) => setStored((current: unknown) => ({ ...readFilters(current), [key]: value })),
    [setStored],
  );
  const toggle = useCallback(
    (key: FacetKey, value: string) =>
      setStored((current: unknown) => {
        const filters = readFilters(current);
        const values = filters[key];
        return {
          ...filters,
          [key]: values.includes(value)
            ? values.filter((one) => one !== value)
            : [...values, value],
        };
      }),
    [setStored],
  );
  const clear = useCallback(
    () =>
      setStored((current: unknown) => {
        const { state, sort } = readFilters(current);
        return { ...DEFAULT_PULL_REQUEST_FILTERS, state, sort };
      }),
    [setStored],
  );

  return { filters, set, toggle, clear };
};

/** What local storage holds, as filters: anything unreadable falls back to the default. */
export const readFilters = (value: unknown): PullRequestFilters => {
  const stored = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    state: oneOf(PULL_REQUEST_LIST_STATES, stored.state, DEFAULT_PULL_REQUEST_FILTERS.state),
    author: strings(stored.author),
    label: strings(stored.label),
    assignee: strings(stored.assignee),
    q: typeof stored.q === "string" ? stored.q : "",
    sort: oneOf(PULL_REQUEST_LIST_SORTS, stored.sort, DEFAULT_PULL_REQUEST_FILTERS.sort),
    involves: stored.involves === true,
  };
};

const oneOf = <T extends string>(choices: readonly T[], value: unknown, fallback: T): T =>
  choices.includes(value as T) ? (value as T) : fallback;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
