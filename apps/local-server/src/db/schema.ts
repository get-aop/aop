import type { ChatRuntimeAccessMode, PullRequestState, ThreadStatus } from "@aop/common";
import type { Generated, Insertable, Selectable, Updateable } from "kysely";
import type { ChatHistoryDatabase } from "./chat-history-schema.ts";
import type { LibraryDatabase } from "./library-schema.ts";
import type { ProjectsDatabase } from "./projects-schema.ts";
import type { UsageDatabase } from "./usage-schema.ts";

export interface SettingsTable {
  key: string;
  value: string;
}

export interface RuntimeConfigurationProvidersTable {
  id: string;
  name: string;
  command: string;
  driver: string;
  built_in: Generated<boolean>;
  position: Generated<number>;
  supports_fast_mode: Generated<boolean>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RuntimeConfigurationModelsTable {
  id: string;
  provider_id: string;
  description: string;
  model: string;
  thinking_levels: string;
  fast_mode: Generated<boolean>;
  built_in: Generated<boolean>;
  position: Generated<number>;
  is_default: Generated<boolean>;
  default_thinking_level: Generated<string | null>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ReposTable {
  id: string;
  path: string;
  name: string | null;
  remote_origin: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageDisposition = "immediate" | "queued" | "steered" | "retry";
export type ChatRunStatus = "running" | "completed" | "failed" | "interrupted" | "cancelled";
export type ChatRunInterruptionKind = "steer" | "abort" | "reset" | "output_limit";
export type ChatContextStrategy = "fresh" | "native_resume" | "aop_history";
export type ChatRuntimeSessionState = "confirmed";

/** What a project session is: the project's coordinator chat or one of its threads. */
export type ChatSessionKind = "coordinator" | "thread";

/** Machine-readable empty-output failure classification on chat_runs. */
export type ChatRunFailureKind = "startup_timeout" | "empty_output" | "rate_limit";

export interface ChatSessionsTable {
  id: string;
  repo_id: string | null;
  title: string;
  named: Generated<boolean>;
  runtime: string;
  runtime_configuration_id: string | null;
  /** Null runs on the CLI's own default: no `--model` is passed. Nullable since migration v9. */
  model: string | null;
  /** Null runs on the CLI's own default: no `--effort` is passed. Nullable since migration v9. */
  reasoning_effort: string | null;
  runtime_alias: string | null;
  runtime_session_id: string | null;
  workspace_path: string | null;
  fast_mode: Generated<boolean>;
  runtime_access_mode?: Generated<ChatRuntimeAccessMode>;
  pinned: Generated<boolean>;
  settled_override: Generated<"settled" | "active" | null>;
  settled_at: Generated<string | null>;
  /** Null means never explicitly marked read; unread count includes all assistant messages. */
  last_read_at: Generated<string | null>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  /**
   * Project columns, added by migration v2. A session outside any project leaves them all
   * null or at their default. The couplings between them are CHECK constraints there.
   */
  project_id: string | null;
  kind: ChatSessionKind | null;
  /** Present exactly on threads. */
  state: ThreadStatus | null;
  /** JSON `BlockedQuestion`, present exactly while `state` is `waiting-on-you`. */
  blocked_question_json: string | null;
  /** JSON `ThreadStep[]`: the checklist the n/m progress ring is derived from. */
  steps_json: Generated<string>;
  status_line: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: PullRequestState | null;
  /** JSON `PullRequestChecks` the pull request watcher last read, added by migration v7. */
  pr_checks_json: string | null;
  /** JSON `ThreadTarget`: where the thread runs. */
  target_json: Generated<string>;
  last_activity_at: string | null;
  /** SQLite has no boolean: 0 or 1. */
  unread: Generated<0 | 1>;
  /** Set exactly when `state` is `resolved`. */
  resolved_at: string | null;
  /**
   * When the session resumes after a rate or usage limit, added by migration v5. A thread has it
   * exactly while `state` is `rate-limited`; a coordinator may hold it at any time.
   */
  resumes_at: string | null;
  /** JSON `ThreadWait`, added by migration v21: what a working thread waits on the person for. */
  waiting_on_json: string | null;
  /** JSON `ThreadDegraded`, added by migration v21: a working thread's AOP tools stopped reaching the host. */
  tools_degraded_json: string | null;
}

export interface ChatMessagesTable {
  id: string;
  session_id: string;
  role: ChatMessageRole;
  content: string;
  action: string | null;
  activity: Generated<string | null>;
  turn_index: Generated<number>;
  disposition: Generated<ChatMessageDisposition>;
  created_at: Generated<string>;
  /** JSON `MessageOrigin`, added by migration v4; null on what a person typed. */
  origin_json: string | null;
  /** JSON `TurnPart[]` of a reply a run wrote, added by migration v16; null on any other row. */
  parts: Generated<string | null>;
  /** The running run this user message was written into mid-turn (migration v18), or null. */
  steered_run_id: Generated<string | null>;
}

export interface ChatRunsTable {
  id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string;
  runtime: string;
  log_file_path: string;
  status: ChatRunStatus;
  /** Runtime session ID discovered during or after the run. */
  runtime_session_id: string | null;
  /** Provider binding supplied when the run started (binding under test). */
  resume_session_id: string | null;
  /** Structured empty-output classification; null for unclassified failures. */
  failure_kind: ChatRunFailureKind | null;
  interruption_kind: ChatRunInterruptionKind | null;
  context_strategy: ChatContextStrategy | null;
  workspace_path: string | null;
  timeout_policy: string | null;
  retry_of_run_id: string | null;
  runtime_session_state: ChatRuntimeSessionState | null;
  error_message: string | null;
  /** OS pid of the detached CLI, recorded at spawn so Stop and recovery work after a server restart. */
  pid: number | null;
  /** JSON `MessageBlock[]` the run's tools produced, added by migration v4. */
  blocks_json: Generated<string>;
  /** The agent CLI version the run's init event named, recorded when it ends (migration v17). */
  cli_version: Generated<string | null>;
  /** The FIFO the running CLI reads steers from (migration v18); null on a run that takes none. */
  input_path: Generated<string | null>;
  /**
   * 1 when the run was launched with a permission-skipping flag, 0 when not, recorded before its
   * CLI starts (migration v19); null on runs from before it.
   */
  permissions_bypassed: Generated<number | null>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface SchemaMigrationsTable {
  version: number;
  name: string;
  applied_at: Generated<string>;
}

export interface Database
  extends ChatHistoryDatabase,
    ProjectsDatabase,
    UsageDatabase,
    LibraryDatabase {
  schema_migrations: SchemaMigrationsTable;
  settings: SettingsTable;
  runtime_configuration_providers: RuntimeConfigurationProvidersTable;
  runtime_configuration_models: RuntimeConfigurationModelsTable;
  repos: ReposTable;
  chat_sessions: ChatSessionsTable;
  chat_messages: ChatMessagesTable;
  chat_runs: ChatRunsTable;
}

export type Setting = Selectable<SettingsTable>;
export type NewSetting = Insertable<SettingsTable>;

export type RuntimeConfigurationProviderRecord = Selectable<RuntimeConfigurationProvidersTable>;
export type RuntimeConfigurationModelRecord = Selectable<RuntimeConfigurationModelsTable>;

export type Repo = Selectable<ReposTable>;
export type NewRepo = Insertable<ReposTable>;
export type RepoUpdate = Updateable<ReposTable>;

export type ChatSession = Selectable<ChatSessionsTable>;
export type NewChatSession = Insertable<ChatSessionsTable>;
export type ChatSessionUpdate = Updateable<ChatSessionsTable>;

export type ChatMessage = Selectable<ChatMessagesTable>;
export type NewChatMessage = Insertable<ChatMessagesTable>;

export type ChatRun = Selectable<ChatRunsTable>;
export type NewChatRun = Insertable<ChatRunsTable>;
export type ChatRunUpdate = Updateable<ChatRunsTable>;
