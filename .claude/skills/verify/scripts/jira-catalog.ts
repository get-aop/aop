/**
 * The fake Jira site's catalog (fake-jira.ts): status categories and statuses, priorities, issue
 * types, projects and components, with the ids Jira Cloud gives them out of the box, plus the
 * shape of one fixture issue before jira-payloads.ts turns it into a REST payload.
 */
import type { Person } from "./jira-people.ts";

export const STATUS_CATEGORIES = {
  new: { id: 2, key: "new", colorName: "blue-gray", name: "To Do" },
  indeterminate: { id: 4, key: "indeterminate", colorName: "yellow", name: "In Progress" },
  done: { id: 3, key: "done", colorName: "green", name: "Done" },
};
export type CategoryKey = keyof typeof STATUS_CATEGORIES;

export const STATUSES = {
  todo: { id: "10000", name: "To Do", category: "new" as CategoryKey },
  progress: { id: "3", name: "In Progress", category: "indeterminate" as CategoryKey },
  review: { id: "10001", name: "In Review", category: "indeterminate" as CategoryKey },
  done: { id: "10002", name: "Done", category: "done" as CategoryKey },
};
export type StatusKey = keyof typeof STATUSES;

/** Ordered from most to least urgent; `ORDER BY priority DESC` puts Highest first. */
export const PRIORITIES = [
  { id: "1", name: "Highest", icon: "highest" },
  { id: "2", name: "High", icon: "high" },
  { id: "3", name: "Medium", icon: "medium" },
  { id: "4", name: "Low", icon: "low" },
  { id: "5", name: "Lowest", icon: "lowest" },
];
export type PriorityName = "Highest" | "High" | "Medium" | "Low" | "Lowest";

export const ISSUE_TYPES = {
  Epic: { id: "10000", avatarId: 10307, level: 1, description: "A big user story." },
  Story: { id: "10001", avatarId: 10315, level: 0, description: "A user-facing feature." },
  Task: { id: "10002", avatarId: 10318, level: 0, description: "A small, distinct piece of work." },
  Bug: { id: "10004", avatarId: 10303, level: 0, description: "A problem or error." },
};
export type TypeName = keyof typeof ISSUE_TYPES;

export const PROJECTS = [
  { id: "10000", key: "APP", name: "Mobile App", avatarId: 10411 },
  { id: "10001", key: "OPS", name: "Operations", avatarId: 10419 },
  { id: "10002", key: "WEB", name: "Website", avatarId: 10424 },
];

export const COMPONENTS: Record<string, string> = {
  Authentication: "10010",
  Notifications: "10011",
  Settings: "10012",
  Onboarding: "10013",
  Database: "10020",
  CI: "10021",
  Monitoring: "10022",
};

export const FIELD_NAMES: Record<string, string> = {
  summary: "Summary",
  issuetype: "Issue Type",
  project: "Project",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  reporter: "Reporter",
  labels: "Labels",
  components: "Components",
  fixVersions: "Fix versions",
  resolution: "Resolution",
  resolutiondate: "Resolved",
  created: "Created",
  updated: "Updated",
  description: "Description",
  comment: "Comment",
  customfield_10050: "Acceptance criteria",
};

export interface IssueSpec {
  id: string;
  key: string;
  summary: string;
  type: TypeName;
  status: StatusKey;
  priority: PriorityName | null;
  assignee: Person | null;
  reporter: Person;
  labels: string[];
  components: string[];
  fixVersion: boolean;
  resolution: "Done" | "Won't Do" | null;
  created: string;
  updated: string;
  /** Set by /__fixture/touch; comments keep their times relative to `updated`. */
  touchedAt?: string;
}
