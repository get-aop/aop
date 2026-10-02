import type { IssueLabel, IssuePerson, IssueSource, IssueStage, ProjectIssue } from "@aop/common";

/*
 * What the Issues tab does to the list it holds: search and filter it, sort it, and group it.
 * The state filter (open, closed, all) is the host's, since it decides what is fetched.
 */

export type IssueGroupBy = "status" | "label" | "milestone" | "assignee" | "repository";
export type IssueSort = "updated" | "created" | "oldest" | "comments";

export const GROUP_BY_LABEL: Record<IssueGroupBy, string> = {
  status: "Status",
  label: "Label",
  milestone: "Milestone",
  assignee: "Assignee",
  repository: "Repository",
};

export const SORT_LABEL: Record<IssueSort, string> = {
  updated: "Recently updated",
  created: "Newest",
  oldest: "Oldest",
  comments: "Most commented",
};

/** The filters a person picks. An empty list means no filter on that field. */
export interface IssueFilters {
  query: string;
  labels: readonly string[];
  /** Logins; `UNASSIGNED` stands for issues with no assignee. */
  assignees: readonly string[];
  authors: readonly string[];
  sources: readonly IssueSource[];
}

export const UNASSIGNED = "";

export const NO_FILTERS: IssueFilters = {
  query: "",
  labels: [],
  assignees: [],
  authors: [],
  sources: [],
};

/** How many filters are on, search not counted (it shows in its own box). */
export const activeFilterCount = (filters: IssueFilters): number =>
  filters.labels.length +
  filters.assignees.length +
  filters.authors.length +
  filters.sources.length;

export const filterIssues = (
  issues: readonly ProjectIssue[],
  filters: IssueFilters,
): ProjectIssue[] => {
  const needle = filters.query.trim().toLowerCase();
  return issues.filter(
    (issue) =>
      matchesAny(filters.sources, [issue.source]) &&
      matchesAny(
        filters.labels,
        issue.labels.map((label) => label.name),
      ) &&
      matchesAny(filters.assignees, assigneeKeys(issue)) &&
      matchesAny(filters.authors, issue.author ? [issue.author.login] : []) &&
      matchesSearch(issue, needle),
  );
};

export const sortIssues = (issues: readonly ProjectIssue[], sort: IssueSort): ProjectIssue[] =>
  [...issues].sort(COMPARE[sort]);

export interface IssueGroup {
  id: string;
  label: string;
  issues: ProjectIssue[];
  /** What the group's marker shows: a workflow stage, or a colour (labels, Linear states). */
  stage: IssueStage | null;
  color: string | null;
}

/**
 * The issues in groups, each group keeping the order it was given. By status the groups follow
 * the workflow (triage first, done and canceled last); by any other field the biggest group
 * comes first and the one for issues without a value ("No label") last. An issue with two
 * labels or two assignees is in both groups.
 */
export const groupIssues = (issues: readonly ProjectIssue[], by: IssueGroupBy): IssueGroup[] => {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    for (const key of GROUP_KEYS[by](issue)) {
      const group = groups.get(key.id) ?? { ...key, issues: [] };
      group.issues.push(issue);
      groups.set(key.id, group);
    }
  }
  return [...groups.values()].sort(by === "status" ? byStage : byCount);
};

export interface Facet {
  value: string;
  label: string;
  count: number;
  color: string | null;
  avatarUrl: string | null;
}

/** The values each filter can take in the list held, with how many issues have each. */
export const facetsOf = (issues: readonly ProjectIssue[]) => {
  const labels = new FacetCounter();
  const assignees = new FacetCounter();
  const authors = new FacetCounter();
  for (const issue of issues) {
    for (const label of issue.labels) labels.add(label.name, label.name, { color: label.color });
    if (issue.assignees.length === 0) assignees.add(UNASSIGNED, "Unassigned", {});
    for (const person of issue.assignees) assignees.add(person.login, person.login, person);
    if (issue.author) authors.add(issue.author.login, issue.author.login, issue.author);
  }
  return { labels: labels.list(), assignees: assignees.list(), authors: authors.list() };
};

/** Turns one value of a filter on or off. */
export const toggleValue = <T>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

const matchesAny = (wanted: readonly string[], values: readonly string[]): boolean =>
  wanted.length === 0 || values.some((value) => wanted.includes(value));

const assigneeKeys = (issue: ProjectIssue): string[] =>
  issue.assignees.length === 0 ? [UNASSIGNED] : issue.assignees.map((person) => person.login);

const matchesSearch = (issue: ProjectIssue, needle: string): boolean => {
  if (!needle) return true;
  const haystack = [
    issue.identifier,
    issue.title,
    issue.container,
    issue.stateName,
    issue.milestone ?? "",
    ...issue.labels.map((label) => label.name),
    ...issue.assignees.map((person) => person.login),
    issue.author?.login ?? "",
  ];
  return haystack.some((text) => text.toLowerCase().includes(needle));
};

const time = (iso: string): number => Date.parse(iso) || 0;

const COMPARE: Record<IssueSort, (a: ProjectIssue, b: ProjectIssue) => number> = {
  updated: (a, b) => time(b.updatedAt) - time(a.updatedAt),
  created: (a, b) => time(b.createdAt) - time(a.createdAt),
  oldest: (a, b) => time(a.createdAt) - time(b.createdAt),
  comments: (a, b) =>
    (b.commentCount ?? 0) - (a.commentCount ?? 0) || time(b.updatedAt) - time(a.updatedAt),
};

type GroupKey = Omit<IssueGroup, "issues">;

const EMPTY_KEY = (id: string, label: string): GroupKey => ({
  id: `none:${id}`,
  label,
  stage: null,
  color: null,
});

const GROUP_KEYS: Record<IssueGroupBy, (issue: ProjectIssue) => GroupKey[]> = {
  status: (issue) => [
    {
      id: `status:${issue.stage}:${issue.stateName}`,
      label: issue.stateName,
      stage: issue.stage,
      color: issue.stateColor,
    },
  ],
  label: (issue) =>
    issue.labels.length === 0
      ? [EMPTY_KEY("label", "No label")]
      : issue.labels.map((label: IssueLabel) => ({
          id: `label:${label.name}`,
          label: label.name,
          stage: null,
          color: label.color,
        })),
  milestone: (issue) => [
    issue.milestone
      ? { id: `milestone:${issue.milestone}`, label: issue.milestone, stage: null, color: null }
      : EMPTY_KEY("milestone", "No milestone"),
  ],
  assignee: (issue) =>
    issue.assignees.length === 0
      ? [EMPTY_KEY("assignee", "Unassigned")]
      : issue.assignees.map((person: IssuePerson) => ({
          id: `assignee:${person.login}`,
          label: person.login,
          stage: null,
          color: null,
        })),
  repository: (issue) => [
    { id: `repository:${issue.container}`, label: issue.container, stage: null, color: null },
  ],
};

export const STAGE_ORDER: readonly IssueStage[] = [
  "triage",
  "started",
  "unstarted",
  "backlog",
  "completed",
  "canceled",
];

const stageRank = (group: IssueGroup): number => STAGE_ORDER.indexOf(group.stage ?? "unstarted");

const byStage = (a: IssueGroup, b: IssueGroup): number =>
  stageRank(a) - stageRank(b) || a.label.localeCompare(b.label);

const byCount = (a: IssueGroup, b: IssueGroup): number => {
  const aEmpty = a.id.startsWith("none:");
  const bEmpty = b.id.startsWith("none:");
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  return b.issues.length - a.issues.length || a.label.localeCompare(b.label);
};

class FacetCounter {
  private readonly facets = new Map<string, Facet>();

  add(value: string, label: string, extra: { color?: string | null; avatarUrl?: string | null }) {
    const facet = this.facets.get(value);
    if (facet) {
      facet.count += 1;
      return;
    }
    this.facets.set(value, {
      value,
      label,
      count: 1,
      color: extra.color ?? null,
      avatarUrl: extra.avatarUrl ?? null,
    });
  }

  list(): Facet[] {
    return [...this.facets.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    );
  }
}
