/**
 * The JQL fields the fake Jira site understands (jira-jql.ts parses, this file matches). Each
 * field lists the values an issue has for it, every spelling lowercased (a project is its key,
 * name and id), so `=`, `in` and `is EMPTY` are set lookups; text fields match words with `~`.
 */
import {
  ISSUE_TYPES,
  type IssueSpec,
  PRIORITIES,
  PROJECTS,
  STATUS_CATEGORIES,
  STATUSES,
} from "./jira-catalog.ts";
import { descriptionOf, issueText } from "./jira-payloads.ts";
import { PEOPLE, type Person } from "./jira-people.ts";
import { adfToText } from "./jira-wiki.ts";

/** A rejected query; the message is the one Jira puts in `errorMessages`. */
export class JqlError extends Error {}

export interface FieldDef {
  /** The field's name in error messages. */
  name: string;
  operators: string[];
  /** Every spelling of every value the issue has; empty when the field is EMPTY. */
  values?: (issue: IssueSpec) => string[];
  /** Words for `~`. */
  text?: (issue: IssueSpec) => string;
  /** Values the site knows; a query naming another is an error, as on Jira. */
  known?: () => string[];
}

const EQUALITY = ["=", "!=", "in", "not in"];
const NULLABLE = [...EQUALITY, "is", "is not"];
const TEXT = ["~", "!~"];

const lower = (values: (string | number | null | undefined)[]) =>
  values
    .filter((value) => value !== null && value !== undefined)
    .map((v) => String(v).toLowerCase());
const identities = (who: Person | null) =>
  who ? lower([who.accountId, who.name, who.key, who.displayName]) : [];
const everyone = () => Object.values(PEOPLE).flatMap(identities);
const projectKey = (issue: IssueSpec) => issue.key.split("-")[0] ?? "";
const statusOf = (issue: IssueSpec) => STATUSES[issue.status];
const categoryOf = (issue: IssueSpec) => STATUS_CATEGORIES[statusOf(issue).category];

const project: FieldDef = {
  name: "project",
  operators: EQUALITY,
  values: (issue) => {
    const found = PROJECTS.find((entry) => entry.key === projectKey(issue));
    return lower([found?.key, found?.name, found?.id]);
  },
  known: () => PROJECTS.flatMap((entry) => lower([entry.key, entry.name, entry.id])),
};

const status: FieldDef = {
  name: "status",
  operators: EQUALITY,
  values: (issue) => lower([statusOf(issue).name, statusOf(issue).id]),
  known: () => Object.values(STATUSES).flatMap((entry) => lower([entry.name, entry.id])),
};

const statusCategory: FieldDef = {
  name: "statusCategory",
  operators: EQUALITY,
  values: (issue) => lower([categoryOf(issue).name, categoryOf(issue).key, categoryOf(issue).id]),
  known: () =>
    Object.values(STATUS_CATEGORIES).flatMap((entry) => lower([entry.name, entry.key, entry.id])),
};

const user = (name: string, pick: (issue: IssueSpec) => Person | null): FieldDef => ({
  name,
  operators: NULLABLE,
  values: (issue) => identities(pick(issue)),
  known: everyone,
});

const priority: FieldDef = {
  name: "priority",
  operators: NULLABLE,
  values: (issue) => {
    const found = PRIORITIES.find((entry) => entry.name === issue.priority);
    return lower([found?.name, found?.id]);
  },
  known: () => PRIORITIES.flatMap((entry) => lower([entry.name, entry.id])),
};

const issuetype: FieldDef = {
  name: "issuetype",
  operators: EQUALITY,
  values: (issue) => lower([issue.type, ISSUE_TYPES[issue.type].id]),
  known: () => Object.entries(ISSUE_TYPES).flatMap(([type, entry]) => lower([type, entry.id])),
};

const key: FieldDef = {
  name: "key",
  operators: EQUALITY,
  values: (issue) => lower([issue.key, issue.id]),
};

const textField = (name: string, text: (issue: IssueSpec) => string): FieldDef => ({
  name,
  operators: TEXT,
  text,
});

/** JQL field names, lowercased, to their definitions; aliases share one. */
export const FIELDS: Record<string, FieldDef> = {
  project,
  status,
  statuscategory: statusCategory,
  assignee: user("assignee", (issue) => issue.assignee),
  reporter: user("reporter", (issue) => issue.reporter),
  labels: { name: "labels", operators: NULLABLE, values: (issue) => lower(issue.labels) },
  component: {
    name: "component",
    operators: NULLABLE,
    values: (issue) => lower(issue.components),
  },
  resolution: {
    name: "resolution",
    operators: NULLABLE,
    values: (issue) => lower([issue.resolution]),
    known: () => ["done", "won't do"],
  },
  priority,
  issuetype,
  type: issuetype,
  key,
  issuekey: key,
  text: textField("text", issueText),
  summary: textField("summary", (issue) => issue.summary),
  description: textField("description", (issue) => adfToText(descriptionOf(issue))),
};

/** Keys `ORDER BY` can sort on; bigger sorts later in ASC. */
export const SORT_KEYS: Record<string, (issue: IssueSpec) => number | string> = {
  updated: (issue) => Date.parse(issue.touchedAt ?? issue.updated),
  created: (issue) => Date.parse(issue.created),
  priority: (issue) => {
    const index = PRIORITIES.findIndex((entry) => entry.name === issue.priority);
    return index === -1 ? 0 : PRIORITIES.length - index;
  },
  key: sortableKey,
  issuekey: sortableKey,
};

function sortableKey(issue: IssueSpec): string {
  return `${projectKey(issue)}-${issue.key.split("-")[1]?.padStart(8, "0")}`;
}
