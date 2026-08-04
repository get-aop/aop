import { readFile, writeFile } from "node:fs/promises";
import {
  BACKGROUND_TASK_LIMIT,
  type ChatDelegationRun,
  type ChatDelegationStatus,
  parseChatDelegationRuns,
  serializeChatDelegationRuns,
} from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { pruneOldBackgroundTasks } from "./background-task-retention.ts";
import {
  buildBackgroundTaskContent,
  extractBackgroundTaskRows,
} from "./background-task-tracker.ts";
import { createSessionRunLogPath } from "./runtime-engine.ts";
import {
  createStreamProgressAccumulator,
  parseStreamProgressLines,
  type StreamCommandRow,
  type StreamProgressSnapshot,
} from "./stream-progress.ts";

/** Cap how many host runs we scan per backfill request. */
const BACKFILL_RUN_LIMIT = 40;

export interface BackgroundTaskBackfillOptions {
  /** When set, scan that session only (no recency cutoff by default). */
  sessionId?: string;
  /** Only runs still running or updated after this ISO timestamp. */
  updatedAfter?: string | null;
  /** Max host runs to inspect. */
  limit?: number;
}

interface HostRunBackfillRow {
  hostRunId: string;
  sessionId: string;
  hostRunStatus: string;
  logFilePath: string | null;
  delegationRuns: string | null;
  runCreatedAt: string;
  runUpdatedAt: string;
  sessionTitle: string | null;
  runtime: string;
  runtimeAlias: string | null;
  runtimeConfigurationId: string | null;
  model: string;
  reasoning: string;
  fastMode: boolean;
}

/**
 * Scan host runtime logs for Task/Agent tools and persist them as
 * `background-task` entries so old sessions get cards without a live turn.
 * Idempotent: existing toolUseId entries are left alone.
 */
export const backfillBackgroundTasksFromLogs = async (
  ctx: LocalServerContext,
  options: BackgroundTaskBackfillOptions = {},
): Promise<number> => {
  const rows = await queryBackfillHostRuns(ctx, options);
  let added = 0;
  for (const row of rows) {
    await pruneOldBackgroundTasks(ctx, row.sessionId);
    const retained = await loadRetainedBackgroundTasks(ctx, row.sessionId);
    const addedForRun = await backfillOneHostRun(ctx, row, retained);
    if (addedForRun === 0) continue;
    added += addedForRun;
    await pruneOldBackgroundTasks(ctx, row.sessionId);
  }
  return added;
};

/**
 * Pure merge: given a host progress snapshot, return the next delegation list
 * with any missing background tasks appended (and log payloads prepared).
 */
export const mergeBackgroundTasksFromProgress = (
  existing: ChatDelegationRun[],
  progress: StreamProgressSnapshot,
  host: {
    hostRunStatus: string;
    runtime: string;
    runtimeAlias: string | null;
    runtimeConfigurationId: string | null;
    model: string;
    reasoning: string;
    fastMode: boolean;
    runCreatedAt: string;
    runUpdatedAt: string;
  },
): {
  entries: ChatDelegationRun[];
  added: Array<{ entry: ChatDelegationRun; content: string }>;
} => {
  const knownToolIds = new Set(
    existing
      .filter((entry) => entry.kind === "background-task" && entry.toolUseId)
      .map((entry) => entry.toolUseId as string),
  );
  const added: Array<{ entry: ChatDelegationRun; content: string }> = [];
  for (const row of extractBackgroundTaskRows(progress)) {
    if (knownToolIds.has(row.id)) continue;
    const label = backgroundTaskLabel(row);
    const phase = phaseForRow(row, host.hostRunStatus);
    const status = statusForPhase(phase, host.hostRunStatus);
    const content = buildBackgroundTaskContent(label, row, progress, phase);
    const entry: ChatDelegationRun = {
      id: `del_bg_${sanitizeToolUseId(row.id)}`,
      kind: "background-task",
      label,
      runtime: host.runtime,
      runtimeAlias: host.runtimeAlias,
      runtimeConfigurationId: host.runtimeConfigurationId,
      model: host.model,
      reasoning: host.reasoning,
      fastMode: host.fastMode,
      status,
      activity: activityForPhase(phase),
      runtimeSessionId: null,
      logFilePath: "", // filled after log path allocation
      error: status === "failed" ? "Background task failed." : null,
      toolUseId: row.id,
      startedAt: host.runCreatedAt,
      updatedAt: host.runUpdatedAt,
    };
    knownToolIds.add(row.id);
    added.push({ entry, content });
  }
  if (added.length === 0) return { entries: existing, added };
  return {
    entries: [...existing, ...added.map((item) => item.entry)],
    added,
  };
};

const backfillOneHostRun = async (
  ctx: LocalServerContext,
  row: HostRunBackfillRow,
  retained: ChatDelegationRun[],
): Promise<number> => {
  if (!row.logFilePath) return 0;
  const progress = await readHostLogProgress(row.logFilePath);
  if (extractBackgroundTaskRows(progress).length === 0) return 0;

  const existing = parseChatDelegationRuns(row.delegationRuns);
  const merged = mergeBackgroundTasksFromProgress(existing, progress, {
    hostRunStatus: row.hostRunStatus,
    runtime: row.runtime,
    runtimeAlias: row.runtimeAlias,
    runtimeConfigurationId: row.runtimeConfigurationId,
    model: row.model,
    reasoning: row.reasoning,
    fastMode: row.fastMode,
    runCreatedAt: row.runCreatedAt,
    runUpdatedAt: row.runUpdatedAt,
  });
  if (merged.added.length === 0) return 0;

  const selected = selectBackfillCandidates(merged.added, retained);
  if (selected.length === 0) return 0;
  const withLogs: ChatDelegationRun[] = [];
  for (const item of selected) {
    const logFilePath = await createSessionRunLogPath(`${row.sessionId}-bg`);
    await writeBackgroundTaskLog(logFilePath, item.content);
    withLogs.push({ ...item.entry, logFilePath });
  }

  const nextEntries = [...existing, ...withLogs];
  await ctx.db
    .updateTable("chat_runs")
    .set({ delegation_runs: serializeChatDelegationRuns(nextEntries) })
    .where("id", "=", row.hostRunId)
    .execute();
  return withLogs.length;
};

const loadRetainedBackgroundTasks = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<ChatDelegationRun[]> => {
  const rows = await ctx.db
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("session_id", "=", sessionId)
    .where("delegation_runs", "is not", null)
    .execute();
  return rows
    .flatMap((row) => parseChatDelegationRuns(row.delegation_runs))
    .filter((entry) => entry.kind === "background-task");
};

const selectBackfillCandidates = (
  candidates: Array<{ entry: ChatDelegationRun; content: string }>,
  retained: ChatDelegationRun[],
): Array<{ entry: ChatDelegationRun; content: string }> => {
  const availableSlots = Math.max(0, BACKGROUND_TASK_LIMIT - retained.length);
  const oldest = [...retained].sort(compareDelegationRecency)[0];
  const selectedIds = new Set(
    (availableSlots > 0 ? candidates.slice(-availableSlots) : []).map(
      (candidate) => candidate.entry.id,
    ),
  );
  if (oldest) {
    for (const candidate of candidates) {
      if (compareDelegationRecency(candidate.entry, oldest) > 0) {
        selectedIds.add(candidate.entry.id);
      }
    }
  }
  return candidates.filter((candidate) => selectedIds.has(candidate.entry.id));
};

const compareDelegationRecency = (left: ChatDelegationRun, right: ChatDelegationRun): number =>
  left.startedAt.localeCompare(right.startedAt) || left.updatedAt.localeCompare(right.updatedAt);

const queryBackfillHostRuns = async (
  ctx: LocalServerContext,
  options: BackgroundTaskBackfillOptions,
): Promise<HostRunBackfillRow[]> => {
  const limit = options.limit ?? BACKFILL_RUN_LIMIT;
  let query = ctx.db
    .selectFrom("chat_runs")
    .innerJoin("chat_sessions", "chat_sessions.id", "chat_runs.session_id")
    .select([
      "chat_runs.id as hostRunId",
      "chat_runs.session_id as sessionId",
      "chat_runs.status as hostRunStatus",
      "chat_runs.log_file_path as logFilePath",
      "chat_runs.delegation_runs as delegationRuns",
      "chat_runs.created_at as runCreatedAt",
      "chat_runs.updated_at as runUpdatedAt",
      "chat_sessions.title as sessionTitle",
      "chat_sessions.runtime as runtime",
      "chat_sessions.runtime_alias as runtimeAlias",
      "chat_sessions.runtime_configuration_id as runtimeConfigurationId",
      "chat_sessions.model as model",
      "chat_sessions.reasoning_effort as reasoning",
      "chat_sessions.fast_mode as fastMode",
    ])
    .where("chat_runs.log_file_path", "is not", null)
    .orderBy("chat_runs.updated_at", "desc")
    .limit(limit);

  if (options.sessionId) {
    query = query.where("chat_runs.session_id", "=", options.sessionId);
  }
  if (options.updatedAfter) {
    const cutoff = options.updatedAfter;
    query = query.where((eb) =>
      eb.or([eb("chat_runs.status", "=", "running"), eb("chat_runs.updated_at", ">", cutoff)]),
    );
  }
  return query.execute() as Promise<HostRunBackfillRow[]>;
};

const readHostLogProgress = async (logFilePath: string): Promise<StreamProgressSnapshot> => {
  const content = await readFile(logFilePath, "utf8").catch(() => "");
  const accumulator = createStreamProgressAccumulator();
  for (const line of content.split("\n")) {
    for (const parsed of parseStreamProgressLines(line)) accumulator.apply(parsed);
  }
  return accumulator.get();
};

const writeBackgroundTaskLog = async (logFilePath: string, content: string): Promise<void> => {
  await writeFile(logFilePath, `${JSON.stringify({ type: "text", data: content })}\n`, "utf8");
};

const phaseForRow = (
  row: StreamCommandRow,
  hostRunStatus: string,
): "running" | "completed" | "failed" => {
  if (row.status === "failed") return "failed";
  if (row.status === "done") return "completed";
  // Tool still open in the log: keep "running" so statusForPhase can map host
  // interrupt/cancel onto cancelled (rather than falsely completed).
  if (
    hostRunStatus === "running" ||
    hostRunStatus === "interrupted" ||
    hostRunStatus === "cancelled"
  ) {
    return "running";
  }
  return hostRunStatus === "failed" ? "failed" : "completed";
};

const statusForPhase = (
  phase: "running" | "completed" | "failed",
  hostRunStatus: string,
): ChatDelegationStatus => {
  if (phase === "failed") return "failed";
  if (phase === "completed") return "completed";
  if (hostRunStatus === "running") return "active";
  if (hostRunStatus === "interrupted" || hostRunStatus === "cancelled") return "cancelled";
  return "failed";
};

const activityForPhase = (phase: "running" | "completed" | "failed"): string => {
  if (phase === "failed") return "Failed";
  if (phase === "completed") return "Completed";
  return "Running";
};

const backgroundTaskLabel = (row: StreamCommandRow): string => {
  const detail = row.detail?.trim();
  if (detail) return detail;
  const tool = row.command.trim() || "Task";
  return tool.charAt(0).toUpperCase() + tool.slice(1);
};

const sanitizeToolUseId = (toolUseId: string): string =>
  toolUseId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
