import type { ChatCheckpointCaptureStatus } from "@aop/common";
import type { Kysely } from "kysely";
import type { ChatCleanupStatus, ChatRevertOperationStatus } from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";
import {
  buildRevertBackupCheckpointRef,
  buildRunCheckpointRef,
} from "../session-git/checkpoint-refs.ts";

export const runCheckpointRef = buildRunCheckpointRef;
export const revertBackupRef = buildRevertBackupCheckpointRef;

export interface SeedChatSessionOptions {
  sessionId: string;
  repoId?: string | null;
  /** One user message, one assistant message, one run, one checkpoint per turn. */
  turns?: number;
  workspacePath?: string;
  worktreeRoot?: string;
  gitCommonDir?: string;
  branch?: string | null;
  headOid?: string | null;
  captureStatus?: ChatCheckpointCaptureStatus;
  withCheckpoints?: boolean;
  updatedAt?: string;
}

export interface SeededChatSession {
  sessionId: string;
  runIds: string[];
  userMessageIds: string[];
  assistantMessageIds: string[];
}

/** Seeds a complete session graph: messages, runs, checkpoints, changed files, events. */
export const seedChatSessionGraph = async (
  db: Kysely<Database>,
  options: SeedChatSessionOptions,
): Promise<SeededChatSession> => {
  const {
    sessionId,
    repoId = null,
    turns = 1,
    workspacePath = `/workspace/${sessionId}`,
    gitCommonDir = "/repo/.git",
    withCheckpoints = true,
    updatedAt = "2026-07-24T09:00:00.000Z",
  } = options;
  const worktreeRoot = options.worktreeRoot ?? workspacePath;

  await db
    .insertInto("chat_sessions")
    .values({
      id: sessionId,
      repo_id: repoId,
      title: sessionId,
      runtime: "claude-code",
      runtime_configuration_id: null,
      model: "test-model",
      reasoning_effort: "medium",
      runtime_alias: null,
      runtime_session_id: null,
      workspace_path: workspacePath,
      default_worker_id: null,
      default_workflow_id: null,
      created_at: "2026-07-24T08:00:00.000Z",
      updated_at: updatedAt,
    })
    .execute();

  const seeded: SeededChatSession = {
    sessionId,
    runIds: [],
    userMessageIds: [],
    assistantMessageIds: [],
  };

  for (let turn = 0; turn < turns; turn += 1) {
    const userMessageId = `umsg_${sessionId}_${turn}`;
    const assistantMessageId = `amsg_${sessionId}_${turn}`;
    const runId = `crun_${sessionId}_${turn}`;
    seeded.userMessageIds.push(userMessageId);
    seeded.assistantMessageIds.push(assistantMessageId);
    seeded.runIds.push(runId);

    await db
      .insertInto("chat_messages")
      .values([
        chatMessage(sessionId, userMessageId, "user", turn),
        chatMessage(sessionId, assistantMessageId, "assistant", turn),
      ])
      .execute();
    await db
      .insertInto("chat_runs")
      .values(chatRun(sessionId, runId, userMessageId, assistantMessageId, workspacePath, turn))
      .execute();
    await db.insertInto("chat_run_events").values(chatRunEvent(runId)).execute();
    await db
      .insertInto("chat_run_changed_files")
      .values({
        run_id: runId,
        path: `${runId}.ts`,
        old_path: null,
        status: "modified",
        additions: 1,
        deletions: 0,
        binary: false,
      })
      .execute();

    if (!withCheckpoints) continue;
    await db
      .insertInto("chat_run_checkpoints")
      .values({
        run_id: runId,
        workspace_path: workspacePath,
        worktree_root: worktreeRoot,
        git_common_dir: gitCommonDir,
        branch: options.branch === undefined ? "main" : options.branch,
        head_oid: options.headOid === undefined ? "head-oid" : options.headOid,
        before_ref: runCheckpointRef(sessionId, runId, "before"),
        after_ref: runCheckpointRef(sessionId, runId, "after"),
        before_oid: "before-oid",
        after_oid: "after-oid",
        before_status: options.captureStatus ?? "ready",
        after_status: options.captureStatus ?? "ready",
        before_error: null,
        after_error: null,
      })
      .execute();
  }

  return seeded;
};

export interface SeedRevertOperationOptions {
  id: string;
  sessionId: string;
  targetRunId: string;
  targetUserMessageId: string;
  targetAssistantMessageId: string;
  targetTurnIndex: number;
  status?: ChatRevertOperationStatus;
  cleanupStatus?: ChatCleanupStatus;
  targetCheckpointRef?: string;
  backupCheckpointRef?: string;
  refsToDeleteJson?: string;
}

export const seedRevertOperation = async (
  db: Kysely<Database>,
  options: SeedRevertOperationOptions,
): Promise<void> => {
  await db
    .insertInto("chat_revert_operations")
    .values({
      id: options.id,
      session_id: options.sessionId,
      target_user_message_id: options.targetUserMessageId,
      target_assistant_message_id: options.targetAssistantMessageId,
      target_run_id: options.targetRunId,
      target_turn_index: options.targetTurnIndex,
      target_checkpoint_ref:
        options.targetCheckpointRef ??
        runCheckpointRef(options.sessionId, options.targetRunId, "before"),
      backup_checkpoint_ref:
        options.backupCheckpointRef ?? revertBackupRef(options.sessionId, options.id),
      status: options.status ?? "applying",
      refs_to_delete_json: options.refsToDeleteJson ?? "[]",
      artifact_paths_json: "[]",
      cleanup_status: options.cleanupStatus ?? "pending",
      error_message: null,
      completed_at: null,
      cleanup_completed_at: null,
    })
    .execute();
};

export const listCleanupJobs = (db: Kysely<Database>) =>
  db
    .selectFrom("chat_checkpoint_cleanup_jobs")
    .selectAll()
    .orderBy("created_at")
    .orderBy("id")
    .execute();

export const countChatRows = async (db: Kysely<Database>): Promise<Record<string, number>> => {
  const tables = [
    "chat_sessions",
    "chat_messages",
    "chat_runs",
    "chat_run_events",
    "chat_run_changed_files",
    "chat_run_checkpoints",
    "chat_revert_operations",
  ] as const;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .executeTakeFirst();
    counts[table] = Number(row?.count ?? 0);
  }
  return counts;
};

const chatMessage = (
  sessionId: string,
  id: string,
  role: "user" | "assistant",
  turnIndex: number,
) => ({
  id,
  session_id: sessionId,
  role,
  content: id,
  action: null,
  activity: null,
  turn_index: turnIndex,
  disposition: "immediate" as const,
  created_at: `2026-07-24T09:${String(turnIndex).padStart(2, "0")}:${role === "user" ? "00" : "01"}.000Z`,
});

const chatRun = (
  sessionId: string,
  runId: string,
  userMessageId: string,
  assistantMessageId: string,
  workspacePath: string,
  turnIndex: number,
) => ({
  id: runId,
  session_id: sessionId,
  user_message_id: userMessageId,
  assistant_message_id: assistantMessageId,
  runtime: "claude-code",
  log_file_path: `/tmp/${runId}.jsonl`,
  status: "completed" as const,
  runtime_session_id: null,
  resume_session_id: null,
  failure_kind: null,
  interruption_kind: null,
  context_strategy: "fresh" as const,
  workspace_path: workspacePath,
  timeout_policy: null,
  retry_of_run_id: null,
  runtime_session_state: null,
  error_message: null,
  delegation_runs: null,
  created_at: `2026-07-24T09:${String(turnIndex).padStart(2, "0")}:02.000Z`,
});

const chatRunEvent = (runId: string) => ({
  id: `event_${runId}`,
  run_id: runId,
  sequence: 1,
  source_kind: "fixture",
  source_index: 1,
  source_subindex: 0,
  provider: null,
  kind: "session" as const,
  phase: "completed" as const,
  status: "completed" as const,
  correlation_id: null,
  title: null,
  summary: null,
  detail: null,
  tool_name: null,
  tool_kind: null,
  input_json: null,
  output_json: null,
  output_text: null,
  exit_code: null,
  payload_truncated: false,
  occurred_at: null,
  metadata_json: null,
});
