import type {
  IssueComment,
  IssueLabel,
  IssuePerson,
  IssuePriority,
  IssuePriorityLevel,
  IssueSection,
  IssueStage,
  JiraCredentials,
  ProjectIssue,
} from "@aop/common";
import { adfToMarkdown, jiraTextToMarkdown } from "./adf-markdown.ts";
import { browseUrl, type JiraIssueNode, webUrl } from "./jira-api.ts";

/** The fields a list asks Jira for: what a row shows, and nothing heavy like comments. */
export const JIRA_LIST_FIELDS = [
  "summary",
  "status",
  "resolution",
  "assignee",
  "reporter",
  "priority",
  "labels",
  "components",
  "fixVersions",
  "project",
  "created",
  "updated",
] as const;

/** The issue view shows the latest comments; the rest are a click away in Jira. */
export const JIRA_DETAIL_COMMENTS_MAX = 50;

/** A Jira issue as the Issues tab shows it. */
export const mapJiraIssue = (node: JiraIssueNode, credentials: JiraCredentials): ProjectIssue => {
  const fields = node.fields ?? {};
  const status = record(fields.status);
  const stage = stageOf(record(status.statusCategory).key, record(fields.resolution).name);
  const assignee = personOf(fields.assignee);
  const project = record(fields.project);
  const created = timestampOf(fields.created) ?? EPOCH;
  return {
    key: `jira:${node.key}`,
    source: "jira",
    repoId: null,
    container: text(project.name) || text(project.key) || node.key.split("-")[0] || "Jira",
    identifier: node.key,
    title: text(fields.summary),
    url: browseUrl(credentials, node.key),
    state: stage === "completed" || stage === "canceled" ? "closed" : "open",
    stage,
    // Not done after all ("Won't Do") reads by its resolution, as GitHub's "Not planned" does.
    stateName:
      (stage === "canceled" && text(record(fields.resolution).name)) ||
      text(status.name) ||
      "Unknown",
    stateColor: null,
    labels: labelsOf(fields),
    assignees: assignee ? [assignee] : [],
    author: personOf(fields.reporter),
    milestone: text(record(list(fields.fixVersions)[0]).name) || null,
    priority: priorityOf(fields.priority),
    // A list read leaves comments out (they are heavy); the issue view counts them.
    commentCount: null,
    createdAt: created,
    updatedAt: timestampOf(fields.updated) ?? created,
    linkedPullRequests: [],
  };
};

/**
 * Where a Jira status stands, from its category: To Do is unstarted, In Progress started, Done
 * completed, unless it was resolved as not to be done ("Won't Do", "Duplicate"), which reads as
 * canceled the way GitHub's "not planned" does.
 */
export const stageOf = (categoryKey: unknown, resolution: unknown): IssueStage => {
  if (categoryKey === "indeterminate") return "started";
  if (categoryKey !== "done") return "unstarted";
  return typeof resolution === "string" && NOT_DONE_RESOLUTION.test(resolution)
    ? "canceled"
    : "completed";
};

const NOT_DONE_RESOLUTION =
  /won'?t|wont|duplicate|cannot reproduce|can't reproduce|declined|rejected|obsolete|invalid/i;

/** Jira's default priority names, and the older ones Server schemes still carry, as levels. */
const PRIORITY_LEVELS: [RegExp, IssuePriorityLevel][] = [
  [/^(highest|blocker|critical|urgent)$/i, "urgent"],
  [/^(high|major)$/i, "high"],
  [/^(medium|normal)$/i, "medium"],
  [/^(low|minor)$/i, "low"],
  [/^(lowest|trivial)$/i, "lowest"],
];

export const priorityOf = (value: unknown): IssuePriority | null => {
  const name = text(record(value).name);
  if (!name) return null;
  const level = PRIORITY_LEVELS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
  return { name, level };
};

/** The description, as Markdown: Cloud sends Atlassian Document Format, Data Center a string. */
export const markdownOf = (value: unknown): string =>
  typeof value === "string" ? jiraTextToMarkdown(value) : adfToMarkdown(value);

/**
 * Fields beside the description a thread needs. Jira has no standard acceptance-criteria field;
 * teams add a custom one, found by its name.
 */
export const sectionsOf = (
  fields: Record<string, unknown>,
  names: Record<string, string>,
): IssueSection[] =>
  Object.entries(names)
    .filter(([id, name]) => id.startsWith("customfield_") && ACCEPTANCE.test(name))
    .map(([id, name]) => ({ title: name, body: markdownOf(fields[id]) }))
    .filter((section) => section.body.trim() !== "");

const ACCEPTANCE = /acceptance criteria/i;

/** The latest comments, oldest first, and how many there are in all. */
export const commentsOf = (value: unknown): { comments: IssueComment[]; total: number } => {
  const holder = record(value);
  const all = list(holder.comments);
  const comments = all.slice(-JIRA_DETAIL_COMMENTS_MAX).map((item, index) => {
    const comment = record(item);
    return {
      id: text(comment.id) || String(index),
      author: personOf(comment.author),
      body: markdownOf(comment.body),
      createdAt: timestampOf(comment.created) ?? EPOCH,
    };
  });
  const total = typeof holder.total === "number" ? holder.total : all.length;
  return { comments, total: Math.max(total, comments.length) };
};

const labelsOf = (fields: Record<string, unknown>): IssueLabel[] => {
  const labels = list(fields.labels).filter((label): label is string => isText(label));
  const components = list(fields.components)
    .map((component) => text(record(component).name))
    .filter(isText);
  return [...new Set([...labels, ...components])].map((name) => ({ name, color: null }));
};

export const personOf = (value: unknown): IssuePerson | null => {
  const user = record(value);
  const name = text(user.displayName) || text(user.name);
  if (!name) return null;
  return { login: name, name, avatarUrl: webUrl(record(user.avatarUrls)["48x48"]) };
};

const EPOCH = new Date(0).toISOString();

/** Jira writes `+0000` offsets; the wire wants ISO 8601. */
const timestampOf = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const at = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(at) ? null : new Date(at).toISOString();
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
