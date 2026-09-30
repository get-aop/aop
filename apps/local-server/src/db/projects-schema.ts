import type { CliProvider, NotificationLevel, ProjectStatus, ReasoningEffort } from "@aop/common";
import type { Generated, Selectable } from "kysely";

export interface ProjectsTable {
  id: string;
  name: string;
  goal: Generated<string>;
  instructions: Generated<string>;
  coordinator_provider: CliProvider;
  coordinator_model: string | null;
  coordinator_effort: ReasoningEffort | null;
  thread_provider: CliProvider;
  thread_model: string | null;
  thread_effort: ReasoningEffort | null;
  notification_level: Generated<NotificationLevel>;
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

export interface ProjectsDatabase {
  projects: ProjectsTable;
  project_repos: ProjectReposTable;
  memory_files: MemoryFilesTable;
  devices: DevicesTable;
  event_log: EventLogTable;
}

export type ProjectRow = Selectable<ProjectsTable>;
export type MemoryFileRow = Selectable<MemoryFilesTable>;
export type DeviceRow = Selectable<DevicesTable>;
export type EventLogRow = Selectable<EventLogTable>;
