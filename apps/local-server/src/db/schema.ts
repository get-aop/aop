import type { ChatRuntimeAccessMode, RuntimeEventKind } from "@aop/common";
import type { Generated, Insertable, Selectable, Updateable } from "kysely";
import type { ChatHistoryDatabase } from "./chat-history-schema.ts";

export interface SettingsTable {
  key: string;
  value: string;
}

export interface RuntimeProfilesTable {
  id: string;
  name: string;
  base_provider: string;
  command: string;
  model: string;
  reasoning: string;
  fast_mode: Generated<boolean>;
  /** Optional SSH execution host id (null = this machine). */
  exec_host_id: Generated<string | null>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
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

export type AgentRole = "architect" | "developer" | "reviewer" | "custom";
export type RuntimeProvider = "hermes" | "pi" | "codex-cli" | "grok-build" | "opencode";
export type AgentProvider =
  | "openai-codex"
  | "anthropic"
  | "pi"
  | "codex-cli"
  | "grok-build"
  | "opencode"
  | `opencode:${string}`;
export type AgentSourceKind =
  | "manual"
  | "hermes-profile"
  | "pi-worker-profile"
  | "codex-cli-worker-profile"
  | "grok-build-worker-profile"
  | "opencode-worker-profile";
export type AgentStatus = "active" | "archived";
export type MembershipRole = "primary" | "secondary" | "observer";
export type ChannelKind = "group" | "private";
export type ChannelAuthorType = "user" | "agent" | "system";
export type StatusColumn = "DRAFT" | "READY" | "IN_PROGRESS" | "DONE";
export type WorkflowSource = "builtin" | "user";
export type WorkflowSkillBlockSource = "user";

export interface WorkflowsTable {
  id: string;
  name: string;
  definition: string;
  source: Generated<WorkflowSource>;
  version: Generated<number>;
  active: Generated<boolean>;
  created_at: Generated<string>;
}

export interface WorkflowSkillBlocksTable {
  id: string;
  type: string;
  category: string;
  description: string;
  signals: string;
  prompt_template: string;
  defaults: string;
  agent: string | null;
  source: Generated<WorkflowSkillBlockSource>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ReposTable {
  id: string;
  path: string;
  name: string | null;
  remote_origin: string | null;
  max_concurrent_tasks: Generated<number>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface TasksTable {
  id: string;
  repo_id: string;
  change_path: string;
  branch_name: string | null;
  worktree_path: string | null;
  status: "DRAFT" | "READY" | "RESUMING" | "WORKING" | "PAUSED" | "BLOCKED" | "DONE" | "REMOVED";
  ready_at: string | null;
  preferred_workflow: string | null;
  base_branch: string | null;
  preferred_provider: string | null;
  retry_from_step: string | null;
  resume_input: string | null;
  archived_at: string | null;
  handoff_pending_approval: Generated<boolean>;
  handoff_requires_approval_override: boolean | null;
  /** Chat session that created this task (Sessions page origin). */
  origin_chat_session_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AgentsTable {
  id: string;
  name: string;
  role: AgentRole;
  runtime_provider: RuntimeProvider;
  provider: AgentProvider;
  model: string;
  auto_distribute_disabled: Generated<boolean>;
  /** Free-text "what this worker focuses on", shown on the board. */
  focus: string | null;
  workflow_id: string;
  status: AgentStatus;
  artifact_path: string;
  source_kind: AgentSourceKind;
  source_ref: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AgentRepoMembershipsTable {
  agent_id: string;
  repo_id: string;
  membership_role: MembershipRole;
  created_at: Generated<string>;
}

export interface ChannelsTable {
  id: string;
  repo_id: string | null;
  owner_agent_id: string | null;
  kind: ChannelKind;
  name: string;
  artifact_path: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface ChannelMembershipsTable {
  channel_id: string;
  agent_id: string;
  created_at: Generated<string>;
}

export interface ChannelMessagesTable {
  id: string;
  channel_id: string;
  author_type: ChannelAuthorType;
  author_agent_id: string | null;
  content: string;
  created_at: Generated<string>;
}

export interface TaskAssignmentsTable {
  id: string;
  task_id: string;
  agent_id: string;
  repo_id: string;
  status_column: StatusColumn;
  is_current: Generated<boolean>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface TaskSourcesTable {
  task_id: string;
  repo_id: string;
  provider: string;
  external_id: string;
  external_ref: string;
  external_url: string;
  title_snapshot: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface TaskDependenciesTable {
  task_id: string;
  depends_on_task_id: string;
  source: string;
  created_at: Generated<string>;
}

export interface ExecutionsTable {
  id: string;
  task_id: string;
  workflow_id: Generated<string>;
  status: "running" | "completed" | "failed" | "aborted" | "cancelled";
  visited_steps: Generated<string>;
  iteration: Generated<number>;
  started_at: string;
  completed_at: string | null;
}

export interface StepExecutionsTable {
  id: string;
  execution_id: string;
  step_id: string | null;
  step_type: string | null;
  agent_pid: number | null;
  session_id: string | null;
  status: "running" | "success" | "failure" | "cancelled" | "awaiting_input";
  exit_code: number | null;
  signal: string | null;
  pause_context: string | null;
  error: string | null;
  attempt: number | null;
  iteration: number | null;
  signals_json: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface StepUsageTable {
  id: Generated<number>;
  step_execution_id: string;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  usage_source: string | null;
  raw_usage_json: string | null;
  created_at: string;
}

export interface StepLogsTable {
  id: Generated<number>;
  step_execution_id: string;
  content: string;
  created_at: string;
}

export interface RuntimeEventsTable {
  id: string;
  task_id: string;
  execution_id: string;
  step_execution_id: string;
  session_id: string | null;
  agent_id: string | null;
  kind: RuntimeEventKind;
  title: string | null;
  message: string | null;
  tool_name: string | null;
  status: string | null;
  source_kind: string;
  source_id: string;
  source_index: number | null;
  occurred_at: string;
  metadata_json: string | null;
  created_at: Generated<string>;
}

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageDisposition = "immediate" | "queued" | "steered" | "retry";
export type ChatRunStatus = "running" | "completed" | "failed" | "interrupted" | "cancelled";
export type ChatRunInterruptionKind = "steer" | "abort" | "reset" | "output_limit";
export type ChatContextStrategy = "fresh" | "native_resume" | "aop_history";
export type ChatRuntimeSessionState = "allocated" | "confirmed";

/** Machine-readable empty-output failure classification on chat_runs. */
export type ChatRunFailureKind = "startup_timeout" | "empty_output";

export interface ChatSessionsTable {
  id: string;
  repo_id: string | null;
  title: string;
  named: Generated<boolean>;
  runtime: string;
  runtime_configuration_id: string | null;
  model: string;
  reasoning_effort: string;
  runtime_alias: string | null;
  runtime_session_id: string | null;
  workspace_path: string | null;
  fast_mode: Generated<boolean>;
  runtime_access_mode?: Generated<ChatRuntimeAccessMode>;
  default_worker_id: string | null;
  default_workflow_id: string | null;
  pinned: Generated<boolean>;
  settled_override: Generated<"settled" | "active" | null>;
  settled_at: Generated<string | null>;
  /** Null means never explicitly marked read; unread count includes all assistant messages. */
  last_read_at: Generated<string | null>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
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
  /** JSON array of ChatDelegationRun: specialists that ran inline in this turn. */
  delegation_runs: Generated<string | null>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

/** Chat-native workflow run status: one sequential background run per session. */
export type WorkflowRunStatus = "running" | "done" | "blocked" | "paused" | "failed";

export interface WorkflowRunsTable {
  id: string;
  session_id: string;
  workflow_id: string;
  workflow_name: string;
  status: WorkflowRunStatus;
  /** The user message that triggered the run. */
  request: string;
  /** Id of the chat message that triggered the run. */
  user_message_id: string;
  /** Id of the chat message carrying the final answer. */
  answer_message_id: string | null;
  current_step_id: string | null;
  /** JSON array of visited step ids. */
  visited_steps: Generated<string | null>;
  iteration: Generated<number>;
  /** Final answer / terminal message text. */
  result: string | null;
  error_message: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  completed_at: string | null;
}

export interface Database extends ChatHistoryDatabase {
  settings: SettingsTable;
  runtime_profiles: RuntimeProfilesTable;
  runtime_configuration_providers: RuntimeConfigurationProvidersTable;
  runtime_configuration_models: RuntimeConfigurationModelsTable;
  workflows: WorkflowsTable;
  workflow_skill_blocks: WorkflowSkillBlocksTable;
  repos: ReposTable;
  tasks: TasksTable;
  agents: AgentsTable;
  agent_repo_memberships: AgentRepoMembershipsTable;
  channels: ChannelsTable;
  channel_memberships: ChannelMembershipsTable;
  channel_messages: ChannelMessagesTable;
  chat_sessions: ChatSessionsTable;
  chat_messages: ChatMessagesTable;
  chat_runs: ChatRunsTable;
  workflow_runs: WorkflowRunsTable;
  task_assignments: TaskAssignmentsTable;
  task_sources: TaskSourcesTable;
  task_dependencies: TaskDependenciesTable;
  executions: ExecutionsTable;
  step_executions: StepExecutionsTable;
  step_usage: StepUsageTable;
  step_logs: StepLogsTable;
  runtime_events: RuntimeEventsTable;
  scheduler_triggers: SchedulerTriggersTable;
  signals: SignalsTable;
}

export type Setting = Selectable<SettingsTable>;
export type NewSetting = Insertable<SettingsTable>;

export type RuntimeProfileRecord = Selectable<RuntimeProfilesTable>;
export type NewRuntimeProfileRecord = Insertable<RuntimeProfilesTable>;
export type RuntimeProfileRecordUpdate = Updateable<RuntimeProfilesTable>;
export type RuntimeConfigurationProviderRecord = Selectable<RuntimeConfigurationProvidersTable>;
export type RuntimeConfigurationModelRecord = Selectable<RuntimeConfigurationModelsTable>;

export type Workflow = Selectable<WorkflowsTable>;
export type NewWorkflow = Insertable<WorkflowsTable>;
export type WorkflowUpdate = Updateable<WorkflowsTable>;

export type WorkflowSkillBlock = Selectable<WorkflowSkillBlocksTable>;
export type NewWorkflowSkillBlock = Insertable<WorkflowSkillBlocksTable>;

export type Repo = Selectable<ReposTable>;
export type NewRepo = Insertable<ReposTable>;
export type RepoUpdate = Updateable<ReposTable>;

export type Task = Selectable<TasksTable>;
export type NewTask = Insertable<TasksTable>;
export type TaskUpdate = Updateable<TasksTable>;

export type Agent = Selectable<AgentsTable>;
export type NewAgent = Insertable<AgentsTable>;
export type AgentUpdate = Updateable<AgentsTable>;

export type AgentRepoMembership = Selectable<AgentRepoMembershipsTable>;
export type NewAgentRepoMembership = Insertable<AgentRepoMembershipsTable>;

export type Channel = Selectable<ChannelsTable>;
export type NewChannel = Insertable<ChannelsTable>;
export type ChannelUpdate = Updateable<ChannelsTable>;

export type ChannelMembership = Selectable<ChannelMembershipsTable>;
export type NewChannelMembership = Insertable<ChannelMembershipsTable>;

export type ChannelMessage = Selectable<ChannelMessagesTable>;
export type NewChannelMessage = Insertable<ChannelMessagesTable>;

export type ChatSession = Selectable<ChatSessionsTable>;
export type NewChatSession = Insertable<ChatSessionsTable>;
export type ChatSessionUpdate = Updateable<ChatSessionsTable>;

export type ChatMessage = Selectable<ChatMessagesTable>;
export type NewChatMessage = Insertable<ChatMessagesTable>;

export type ChatRun = Selectable<ChatRunsTable>;
export type WorkflowRun = Selectable<WorkflowRunsTable>;
export type NewChatRun = Insertable<ChatRunsTable>;
export type ChatRunUpdate = Updateable<ChatRunsTable>;

export type TaskAssignment = Selectable<TaskAssignmentsTable>;
export type NewTaskAssignment = Insertable<TaskAssignmentsTable>;
export type TaskAssignmentUpdate = Updateable<TaskAssignmentsTable>;

export type TaskSource = Selectable<TaskSourcesTable>;
export type NewTaskSource = Insertable<TaskSourcesTable>;
export type TaskSourceUpdate = Updateable<TaskSourcesTable>;

export type TaskDependency = Selectable<TaskDependenciesTable>;
export type NewTaskDependency = Insertable<TaskDependenciesTable>;

export type Execution = Selectable<ExecutionsTable>;
export type NewExecution = Insertable<ExecutionsTable>;
export type ExecutionUpdate = Updateable<ExecutionsTable>;

export type StepExecution = Selectable<StepExecutionsTable>;
export type NewStepExecution = Insertable<StepExecutionsTable>;
export type StepExecutionUpdate = Updateable<StepExecutionsTable>;

export type StepUsage = Selectable<StepUsageTable>;
export type NewStepUsage = Insertable<StepUsageTable>;

export type StepLog = Selectable<StepLogsTable>;
export type NewStepLog = Insertable<StepLogsTable>;

export type RuntimeEventRecord = Selectable<RuntimeEventsTable>;
export type NewRuntimeEventRecord = Insertable<RuntimeEventsTable>;

export interface SchedulerTriggersTable {
  id: string;
  repo_id: string;
  name: string;
  action: "re_import_tracker" | "auto_promote_draft_to_ready";
  cadence_secs: number;
  enabled: boolean;
  max_items_per_run: number;
  require_approval_before_handoff: boolean;
  allowed_sources_json: string | null;
  last_run_at: string | null;
  last_result_json: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export type SignalKind = "follow-up" | "regression" | "dependency" | "flaky-test" | "docs-gap";
export type SignalProvenance = "aop" | "external" | "human";
export type SignalConfidence = "low" | "medium" | "high";

export interface SignalsTable {
  id: string;
  repo_id: string;
  source_task_id: string | null;
  source_execution_id: string | null;
  kind: SignalKind;
  title: string;
  body: string;
  provenance: SignalProvenance;
  confidence: SignalConfidence;
  consumed_at: string | null;
  consumed_task_id: string | null;
  created_at: Generated<string>;
}

export type SchedulerTrigger = Selectable<SchedulerTriggersTable>;
export type NewSchedulerTrigger = Insertable<SchedulerTriggersTable>;
export type SchedulerTriggerUpdate = Updateable<SchedulerTriggersTable>;
export type Signal = Selectable<SignalsTable>;
export type NewSignal = Insertable<SignalsTable>;
