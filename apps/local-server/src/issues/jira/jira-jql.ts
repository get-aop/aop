import type { IssueStateFilter, JiraFilter } from "@aop/common";

/**
 * The JQL a list runs: the saved filter (projects, an advanced query, or both), the tab's state
 * filter on top, and the query's own order or newest update first. The person's query is
 * wrapped in parentheses so its ORs cannot swallow the clauses added to it.
 */
export const jiraListJql = (filter: JiraFilter, state: IssueStateFilter): string => {
  const { where, orderBy } = splitOrderBy(filter.jql ?? "");
  const clauses = [
    filter.projects.length > 0 ? `project in (${filter.projects.map(quote).join(", ")})` : null,
    where || null,
    STATE_CLAUSE[state],
  ].filter((clause): clause is string => clause !== null);
  return `${clauses.map((clause) => `(${clause})`).join(" AND ")} ORDER BY ${orderBy ?? "updated DESC"}`;
};

const STATE_CLAUSE: Record<IssueStateFilter, string | null> = {
  open: "statusCategory != Done",
  closed: "statusCategory = Done",
  all: null,
};

/**
 * A query's condition and its ORDER BY, split at the last ORDER BY outside quotes. JQL allows
 * one, at the end.
 */
export const splitOrderBy = (jql: string): { where: string; orderBy: string | null } => {
  const at = lastOrderBy(jql);
  if (at === -1) return { where: jql.trim(), orderBy: null };
  const orderBy = jql
    .slice(at)
    .replace(/^order\s+by\s+/i, "")
    .trim();
  return { where: jql.slice(0, at).trim(), orderBy: orderBy || null };
};

const lastOrderBy = (jql: string): number => {
  const pattern = /\border\s+by\b/gi;
  let found = -1;
  for (let match = pattern.exec(jql); match; match = pattern.exec(jql)) {
    if (!insideQuotes(jql, match.index)) found = match.index;
  }
  return found;
};

const insideQuotes = (text: string, index: number): boolean => {
  let quote: string | null = null;
  for (let at = 0; at < index; at++) {
    const char = text[at];
    if (char === "\\") at++;
    else if (quote === null && (char === '"' || char === "'")) quote = char;
    else if (char === quote) quote = null;
  }
  return quote !== null;
};

// Keys are validated (letters, digits, underscores), so quoting cannot be escaped out of.
const quote = (key: string): string => `"${key}"`;
