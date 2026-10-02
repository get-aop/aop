import type { IssueStateFilter } from "@aop/common";
import { useCallback, useState } from "react";
import { useLocalStorage } from "../../hooks/use-local-storage";
import {
  GROUP_BY_LABEL,
  type IssueFilters,
  type IssueGroupBy,
  type IssueSort,
  NO_FILTERS,
  SORT_LABEL,
} from "./issue-view";

/** How the person likes the tab laid out: kept per project on this device, like open tabs. */
export interface IssueViewPreferences {
  state: IssueStateFilter;
  groupBy: IssueGroupBy;
  sort: IssueSort;
}

export const DEFAULT_PREFERENCES: IssueViewPreferences = {
  state: "open",
  groupBy: "status",
  sort: "updated",
};

export interface IssueView extends IssueViewPreferences {
  setState: (state: IssueStateFilter) => void;
  setGroupBy: (groupBy: IssueGroupBy) => void;
  setSort: (sort: IssueSort) => void;
  filters: IssueFilters;
  setFilters: (update: (filters: IssueFilters) => IssueFilters) => void;
  clearFilters: () => void;
  /** Whether a group is folded: as the person left it, else `folded` (how it starts). */
  isCollapsed: (groupId: string, folded: boolean) => boolean;
  /** Folds or unfolds a group the way the person sees it now. */
  setCollapsed: (groupId: string, collapsed: boolean) => void;
}

const storageKey = (projectId: string) => `aop:issues-view:v1:${projectId}`;

export const useIssueView = (projectId: string): IssueView => {
  const [stored, setStored] = useLocalStorage<Partial<IssueViewPreferences>>(
    storageKey(projectId),
    {},
  );
  const preferences = validPreferences(stored);
  const [filters, setFilterState] = useState<IssueFilters>(NO_FILTERS);
  // The groups the person folded or unfolded, so a group keeps its place across views.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());

  const update = useCallback(
    (patch: Partial<IssueViewPreferences>) =>
      setStored((current) => ({ ...validPreferences(current), ...patch })),
    [setStored],
  );

  return {
    ...preferences,
    setState: (state) => update({ state }),
    setGroupBy: (groupBy) => update({ groupBy }),
    setSort: (sort) => update({ sort }),
    filters,
    setFilters: (change) => setFilterState((current) => change(current)),
    clearFilters: () => setFilterState(NO_FILTERS),
    isCollapsed: (groupId, folded) => chosen.get(groupId) ?? folded,
    setCollapsed: (groupId, collapsed) =>
      setChosen((current) => new Map(current).set(groupId, collapsed)),
  };
};

const STATES: readonly IssueStateFilter[] = ["open", "closed", "all"];

// What a device stored may be from another version, or edited by hand.
const validPreferences = (value: unknown): IssueViewPreferences => {
  const stored = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    state: pick(stored.state, STATES, DEFAULT_PREFERENCES.state),
    groupBy: pick(stored.groupBy, Object.keys(GROUP_BY_LABEL) as IssueGroupBy[], "status"),
    sort: pick(stored.sort, Object.keys(SORT_LABEL) as IssueSort[], "updated"),
  };
};

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;
