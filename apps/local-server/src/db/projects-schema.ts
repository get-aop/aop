import type {
  CliProvider,
  ComputerUse,
  NotificationLevel,
  ProjectColor,
  ProjectIcon,
  ProjectStatus,
  ReasoningEffort,
  ThreadAccess,
} from "@aop/common";
import type { Generated, Selectable } from "kysely";

export interface ProjectsTable {
  id: string;
  name: string;
  /** Added by migration v16. Null keeps the letter tile on the id's colour. */
  icon: Generated<ProjectIcon | null>;
  color: Generated<ProjectColor | null>;
  goal: Generated<string>;
  instructions: Generated<string>;
  coordinator_provider: CliProvider;
  coordinator_model: string | null;
  coordinator_effort: ReasoningEffort | null;
  thread_provider: CliProvider;
  thread_model: string | null;
  thread_effort: ReasoningEffort | null;
  notification_level: Generated<NotificationLevel>;
  /** Added by migration v4. */
  thread_access: Generated<ThreadAccess>;
  /** Added by migration v7. SQLite has no boolean: 0 or 1. */
  auto_fix_pull_requests: Generated<0 | 1>;
  /** Added by migration v14: a rate-limited thread resumes at the reset (1) or waits for the person (0). */
  auto_continue: Generated<0 | 1>;
  /** Added by migration v19: where threads get computer and browser use from. */
  computer_use: Generated<ComputerUse>;
  /** Added by migration v13: what a role's last run on "Use default" reported. Null until one does. */
  coordinator_reported_model: Generated<string | null>;
  coordinator_reported_effort: Generated<ReasoningEffort | null>;
  thread_reported_model: Generated<string | null>;
  thread_reported_effort: Generated<ReasoningEffort | null>;
  status: Generated<ProjectStatus>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ProjectReposTable {
  project_id: string;
  repo_id: string;
  /** Order of the project's `repoIds`. */
  position: number;
}

export interface MemoryFilesTable {
  project_id: string;
  name: string;
  description: Generated<string>;
  body: Generated<string>;
  updated_at: Generated<string>;
}

export interface DevicesTable {
  id: string;
  name: string;
  /** Hash of the bearer token; the token itself is shown once at pairing and never stored. */
  token_hash: string;
  created_at: Generated<string>;
  last_seen_at: string | null;
}

export interface EventLogTable {
  /** AUTOINCREMENT, so an id is never reused after old entries are trimmed. */
  id: Generated<number>;
  project_id: string;
  type: string;
  /** JSON object; its shape is the one `type` promises in `EventLogEntrySchema`. */
  payload: string;
  created_at: Generated<string>;
}

export interface PullRequestWatchTable {
  thread_id: string;
  /** JSON array of what the watcher has already sent for this thread's pull request. */
  entries_json: Generated<string>;
  updated_at: Generated<string>;
}

export interface SuggestionAnswersTable {
  /** The coordinator message whose `suggested-threads` block made the proposal. */
  message_id: string;
  /** The proposal's id in that block. */
  suggestion_id: string;
  state: "started" | "skipped";
  /** The thread a start made; present exactly when `state` is `started`. */
  thread_id: string | null;
}

export type ProjectKickoffState = "pending" | "surveying" | "reported";

export interface ProjectKickoffsTable {
  project_id: string;
  state: ProjectKickoffState;
  /** The survey thread; present exactly when `state` is not `pending`. */
  survey_thread_id: string | null;
}

export interface ProjectsDatabase {
  projects: ProjectsTable;
  project_repos: ProjectReposTable;
  memory_files: MemoryFilesTable;
  devices: DevicesTable;
  event_log: EventLogTable;
  pull_request_watch: PullRequestWatchTable;
  suggestion_answers: SuggestionAnswersTable;
  project_kickoffs: ProjectKickoffsTable;
}

export type ProjectRow = Selectable<ProjectsTable>;
export type MemoryFileRow = Selectable<MemoryFilesTable>;
export type DeviceRow = Selectable<DevicesTable>;
export type EventLogRow = Selectable<EventLogTable>;
export type SuggestionAnswerRow = Selectable<SuggestionAnswersTable>;
