import type {
  PullRequestFacet,
  PullRequestListQuery,
  PullRequestListSort,
  PullRequestListState,
} from "@aop/common";
import type { ListedPullRequest } from "./mapping.ts";

type PullRequestListItem = ListedPullRequest["item"];

export interface PullRequestFacets {
  authors: PullRequestFacet[];
  labels: PullRequestFacet[];
  assignees: PullRequestFacet[];
}

/**
 * The pull requests the query asks for, sorted, and the filters' choices. The choices count
 * the pull requests of the chosen state only, so a choice never leads to an empty list by itself.
 */
export const selectPullRequests = (
  listed: readonly ListedPullRequest[],
  query: PullRequestListQuery,
  viewerLogin: string,
): { matching: ListedPullRequest[]; facets: PullRequestFacets } => {
  const ofState = listed.filter(({ item }) => matchesState(item, query.state));
  const matching = ofState.filter((pull) => matchesFilters(pull, query, viewerLogin));
  return { matching: sortPullRequests(matching, query.sort), facets: facetsOf(ofState) };
};

/** One page of `items` from `cursor` (an offset the last page handed out). */
export const pageOf = <T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
): { page: T[]; nextCursor: string | null } => {
  const start = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
  const end = start + limit;
  return { page: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
};

const matchesState = (item: PullRequestListItem, state: PullRequestListState): boolean => {
  if (state === "all") return true;
  if (state === "open") return item.state === "open" || item.state === "draft";
  return item.state === state;
};

const matchesFilters = (
  { item, involved }: ListedPullRequest,
  query: PullRequestListQuery,
  viewerLogin: string,
): boolean =>
  anyOf(query.author, item.author ? [item.author.login] : []) &&
  anyOf(
    query.assignee,
    item.assignees.map((user) => user.login),
  ) &&
  query.label.every((label) => item.labels.some((candidate) => sameName(candidate.name, label))) &&
  (!query.involves || involved.some((login) => sameName(login, viewerLogin))) &&
  matchesText(item, query.q);

/** No choice matches everything; otherwise one of `values` must be chosen. */
const anyOf = (chosen: readonly string[], values: readonly string[]): boolean =>
  chosen.length === 0 || chosen.some((one) => values.some((value) => sameName(value, one)));

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const matchesText = (item: PullRequestListItem, q: string): boolean => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    item.title,
    `#${item.number}`,
    item.headRefName,
    item.repo,
    item.author?.login ?? "",
  ]
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
};

type Compare = (a: PullRequestListItem, b: PullRequestListItem) => number;

const byTime =
  (field: "updatedAt" | "createdAt", direction: 1 | -1): Compare =>
  (a, b) =>
    direction * (Date.parse(a[field]) - Date.parse(b[field]));

const SORTS: Record<PullRequestListSort, Compare> = {
  updated: byTime("updatedAt", -1),
  "least-updated": byTime("updatedAt", 1),
  newest: byTime("createdAt", -1),
  oldest: byTime("createdAt", 1),
  "most-commented": (a, b) => b.comments - a.comments || byTime("updatedAt", -1)(a, b),
  "least-commented": (a, b) => a.comments - b.comments || byTime("updatedAt", -1)(a, b),
};

const sortPullRequests = (
  pulls: ListedPullRequest[],
  sort: PullRequestListSort,
): ListedPullRequest[] => {
  const compare = SORTS[sort];
  // Ties keep one order across reads: repository, then number.
  return pulls.sort(
    (a, b) =>
      compare(a.item, b.item) ||
      a.item.repo.localeCompare(b.item.repo) ||
      b.item.number - a.item.number,
  );
};

const facetsOf = (pulls: readonly ListedPullRequest[]): PullRequestFacets => {
  const authors = new Facets();
  const labels = new Facets();
  const assignees = new Facets();
  for (const { item } of pulls) {
    if (item.author) authors.add(item.author.login, item.author.avatarUrl, null);
    for (const label of item.labels) labels.add(label.name, null, label.color);
    for (const user of item.assignees) assignees.add(user.login, user.avatarUrl, null);
  }
  return { authors: authors.list(), labels: labels.list(), assignees: assignees.list() };
};

class Facets {
  private readonly byValue = new Map<string, PullRequestFacet>();

  add(value: string, avatarUrl: string | null, color: string | null): void {
    const facet = this.byValue.get(value);
    if (facet) facet.count += 1;
    else this.byValue.set(value, { value, count: 1, avatarUrl, color });
  }

  /** Most used first, then by name. */
  list(): PullRequestFacet[] {
    return [...this.byValue.values()].sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    );
  }
}
