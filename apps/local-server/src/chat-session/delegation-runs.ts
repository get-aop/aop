import { readFile } from "node:fs/promises";
import {
  type ChatDelegationKind,
  type ChatDelegationRun,
  type ChatDelegationRunDto,
  parseChatDelegationRuns,
  serializeChatDelegationRuns,
} from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { pruneOldBackgroundTasks } from "./background-task-retention.ts";
import { publishChatSessionEvent } from "./session-events.ts";
import {
  createStreamProgressAccumulator,
  parseStreamProgressLines,
  type StreamProgressSnapshot,
} from "./stream-progress.ts";

/** Terminal age cutoff for rebuild reads: recent finished delegations stay inspectable. */
const TERMINAL_VISIBILITY_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Persistence cadence for activity lines; events ride the same write. */
const ACTIVITY_WRITE_INTERVAL_MS = 1_500;
const ACTIVITY_MAX_LENGTH = 80;

export interface DelegationRunSpec {
  kind: ChatDelegationKind;
  label: string;
  runtime: string;
  runtimeAlias: string | null;
  runtimeConfigurationId: string | null;
  model: string;
  reasoning: string;
  fastMode: boolean;
  logFilePath: string;
  /** Host tool_use id when kind is background-task. */
  toolUseId?: string | null;
}

export interface DelegationRunOutcome {
  status: "completed" | "failed" | "cancelled";
  runtimeSessionId?: string | null;
  error?: string | null;
}

/** Map a specialist run result to its terminal delegation outcome. */
export const delegationOutcomeFor = (result: {
  failed?: boolean;
  interrupted?: boolean;
  aborted?: boolean;
  runtimeSessionId?: string | null;
  text?: string;
}): DelegationRunOutcome => {
  if (result.interrupted || result.aborted) return { status: "cancelled" };
  if (result.failed) {
    const firstLine = result.text?.split("\n").find((line) => line.trim()) ?? null;
    return {
      status: "failed",
      error: firstLine ? truncateActivity(firstLine) : "Specialist run failed.",
    };
  }
  return { status: "completed", runtimeSessionId: result.runtimeSessionId ?? null };
};

const PROGRESS_RELAY_INTERVAL_MS = 500;

/**
 * Wrap a specialist's progress listener: republish output as delegation-progress
 * events (throttled) and record the latest activity line. Specialist output is
 * deliberately NOT forwarded to the host stream — it belongs to the card surface.
 */
export const relayDelegationProgress = (
  ctx: LocalServerContext,
  hostRun: Pick<ChatRun, "id" | "session_id">,
  delegationId: string,
  options: { publishIntervalMs?: number; now?: () => number } = {},
): ((progress: StreamProgressSnapshot) => void) => {
  const publishIntervalMs = options.publishIntervalMs ?? PROGRESS_RELAY_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let lastPublishAt = 0;
  return (progress) => {
    const at = now();
    if (at - lastPublishAt < publishIntervalMs) return;
    lastPublishAt = at;
    publishChatSessionEvent({
      type: "delegation-progress",
      sessionId: hostRun.session_id,
      delegationId,
      thinking: progress.thinking,
      content: progress.content,
      commandGroups: progress.commandGroups,
    });
    const activity = deriveDelegationActivity(progress);
    if (activity) {
      void noteDelegationActivity(ctx, hostRun.id, delegationId, activity).catch(() => {});
    }
  };
};

interface HostRunRef {
  id: string;
  sessionId: string;
}

const lastActivityWriteAt = new Map<string, number>();
/** Serialize JSON RMW on chat_runs.delegation_runs per host run (single-process). */
const hostDelegationLocks = new Map<string, Promise<void>>();

/**
 * Mutual exclusion for all writers of one host run's delegation_runs blob.
 * Prevents note/finish/start races from resurrecting terminal entries as active.
 */
export const withHostDelegationLock = async <T>(
  hostRunId: string,
  work: () => Promise<T>,
): Promise<T> => {
  const prior = hostDelegationLocks.get(hostRunId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  hostDelegationLocks.set(
    hostRunId,
    prior.then(() => gate),
  );
  await prior.catch(() => {});
  try {
    return await work();
  } finally {
    release();
  }
};

/** Append a specialist entry to the host run and announce it. */
export const startDelegationRun = async (
  ctx: LocalServerContext,
  hostRun: ChatRun,
  spec: DelegationRunSpec,
): Promise<ChatDelegationRun> => {
  const now = new Date().toISOString();
  const entry: ChatDelegationRun = {
    id: `del_${crypto.randomUUID()}`,
    kind: spec.kind,
    label: spec.label,
    runtime: spec.runtime,
    runtimeAlias: spec.runtimeAlias,
    runtimeConfigurationId: spec.runtimeConfigurationId,
    model: spec.model,
    reasoning: spec.reasoning,
    fastMode: spec.fastMode,
    status: "active",
    activity: null,
    runtimeSessionId: null,
    logFilePath: spec.logFilePath,
    error: null,
    ...(spec.toolUseId ? { toolUseId: spec.toolUseId } : {}),
    startedAt: now,
    updatedAt: now,
  };
  const host = { id: hostRun.id, sessionId: hostRun.session_id };
  const result = await updateDelegationEntries(ctx, host, (entries) => [...entries, entry]);
  const stored = result?.entries.find((item) => item.id === entry.id) ?? entry;
  if (stored.kind === "background-task") {
    await pruneOldBackgroundTasks(ctx, host.sessionId);
  }
  if (result) await publishDelegation(ctx, host, stored);
  return stored;
};

/** Record the latest activity line for a live specialist (throttled writes). */
export const noteDelegationActivity = async (
  ctx: LocalServerContext,
  hostRunId: string,
  delegationId: string,
  activity: string,
): Promise<void> => {
  const nowMs = Date.now();
  const lastWrite = lastActivityWriteAt.get(delegationId) ?? 0;
  if (nowMs - lastWrite < ACTIVITY_WRITE_INTERVAL_MS) return;

  const result = await updateDelegationEntries(ctx, { id: hostRunId }, (entries) =>
    entries.map((entry) =>
      entry.id === delegationId && entry.status === "active"
        ? { ...entry, activity, updatedAt: new Date(nowMs).toISOString() }
        : entry,
    ),
  );
  if (!result) return;
  lastActivityWriteAt.set(delegationId, nowMs);
  const entry = result.entries.find((item) => item.id === delegationId);
  if (entry) await publishDelegation(ctx, result.host, entry);
};

/** Transition a specialist to a terminal state and announce it. */
export const finishDelegationRun = async (
  ctx: LocalServerContext,
  hostRunId: string,
  delegationId: string,
  outcome: DelegationRunOutcome,
): Promise<ChatDelegationRun | null> => {
  lastActivityWriteAt.delete(delegationId);
  const now = new Date().toISOString();
  const existing = await loadDelegationEntry(ctx, hostRunId, delegationId);
  const terminalActivity = await resolveTerminalActivity(existing, outcome);
  const result = await updateDelegationEntries(ctx, { id: hostRunId }, (entries) =>
    entries.map((entry) =>
      entry.id === delegationId && entry.status === "active"
        ? {
            ...entry,
            status: outcome.status,
            activity: terminalActivity ?? entry.activity,
            runtimeSessionId: outcome.runtimeSessionId ?? entry.runtimeSessionId,
            error: outcome.error ?? entry.error,
            updatedAt: now,
          }
        : entry,
    ),
  );
  const entry = result?.entries.find((item) => item.id === delegationId) ?? null;
  if (result && entry) await publishDelegation(ctx, result.host, entry);
  return entry;
};

/** Final activity line for a terminal entry (specialist log vs background-task labels). */
const resolveTerminalActivity = async (
  existing: ChatDelegationRun | null,
  outcome: DelegationRunOutcome,
): Promise<string | null> => {
  if (!existing) return null;
  if (existing.kind === "background-task") {
    if (outcome.status === "failed") return "Failed";
    if (outcome.status === "completed") return "Completed";
    return existing.activity;
  }
  // Completed specialists refresh activity from their log (throttled live writes can lag).
  if (outcome.status === "completed" && existing.logFilePath) {
    return deriveDelegationActivity(await readDelegationOutput(existing.logFilePath));
  }
  return existing.activity;
};

/**
 * Map live entries to their terminal cascade state when the host turn ends.
 * Pure so run-finalization can apply it inside its claim transaction.
 */
export const cascadeDelegationsForHostTerminal = (
  entries: ChatDelegationRun[],
  hostStatus: "completed" | "failed" | "interrupted" | "cancelled",
  now: string,
): { entries: ChatDelegationRun[]; changed: ChatDelegationRun[] } => {
  const changed: ChatDelegationRun[] = [];
  const mapped = entries.map((entry) => {
    if (entry.status !== "active") return entry;
    const cascaded: ChatDelegationRun = {
      ...entry,
      status: hostStatus === "interrupted" || hostStatus === "cancelled" ? "cancelled" : "failed",
      error:
        hostStatus === "interrupted" || hostStatus === "cancelled"
          ? entry.error
          : (entry.error ?? "The chat turn ended before the specialist reported a result."),
      updatedAt: now,
    };
    changed.push(cascaded);
    return cascaded;
  });
  return { entries: mapped, changed };
};

/** Flattened delegation DTOs for card rebuilds; optionally scoped to one session. */
export const listChatDelegations = async (
  ctx: LocalServerContext,
  sessionId?: string,
): Promise<ChatDelegationRunDto[]> => {
  const { backfillBackgroundTasksFromLogs } = await import("./background-task-backfill.ts");
  // Session open: reconstruct Task/Agent cards from host logs (any age).
  // Active list: only recent/running runs so global rebuild stays cheap.
  const cutoff = new Date(Date.now() - TERMINAL_VISIBILITY_WINDOW_MS).toISOString();
  await backfillBackgroundTasksFromLogs(ctx, {
    sessionId,
    updatedAfter: sessionId ? null : cutoff,
  });
  await pruneOldBackgroundTasks(ctx, sessionId);
  // Session-scoped lists keep reconstructed historical cards; the global
  // active endpoint still uses the recency window.
  const rows = await queryDelegationRows(ctx, sessionId, sessionId ? null : cutoff);
  return rows.flatMap((row) =>
    parseChatDelegationRuns(row.delegationRuns).map((entry) =>
      toDelegationDto(entry, {
        hostRunId: row.hostRunId,
        hostRunStatus: row.hostRunStatus,
        sessionId: row.sessionId,
        sessionTitle: row.sessionTitle,
      }),
    ),
  );
};

/** Single delegation lookup without the recency window (e.g. output inspection). */
export const getChatDelegation = async (
  ctx: LocalServerContext,
  sessionId: string,
  delegationId: string,
): Promise<ChatDelegationRunDto | null> => {
  const rows = await queryDelegationRows(ctx, sessionId, null);
  for (const row of rows) {
    const entry = parseChatDelegationRuns(row.delegationRuns).find(
      (item) => item.id === delegationId,
    );
    if (entry) {
      return toDelegationDto(entry, {
        hostRunId: row.hostRunId,
        hostRunStatus: row.hostRunStatus,
        sessionId: row.sessionId,
        sessionTitle: row.sessionTitle,
      });
    }
  }
  return null;
};

/** Rebuild a specialist's streamed output from its persisted runtime log. */
export const readDelegationOutput = async (
  logFilePath: string,
): Promise<StreamProgressSnapshot> => {
  const content = await readFile(logFilePath, "utf8").catch(() => "");
  const accumulator = createStreamProgressAccumulator();
  for (const line of content.split("\n")) {
    for (const parsed of parseStreamProgressLines(line)) accumulator.apply(parsed);
  }
  return accumulator.get();
};

const queryDelegationRows = async (
  ctx: LocalServerContext,
  sessionId: string | undefined,
  terminalCutoff: string | null,
) => {
  let query = ctx.db
    .selectFrom("chat_runs")
    .innerJoin("chat_sessions", "chat_sessions.id", "chat_runs.session_id")
    .select([
      "chat_runs.id as hostRunId",
      "chat_runs.session_id as sessionId",
      "chat_runs.status as hostRunStatus",
      "chat_runs.delegation_runs as delegationRuns",
      "chat_sessions.title as sessionTitle",
    ])
    .where("chat_runs.delegation_runs", "is not", null);
  if (terminalCutoff) {
    query = query.where((eb) =>
      eb.or([
        eb("chat_runs.status", "=", "running"),
        eb("chat_runs.updated_at", ">", terminalCutoff),
      ]),
    );
  }
  if (sessionId) query = query.where("chat_runs.session_id", "=", sessionId);
  return query.execute();
};

/** Short human activity line derived from real streamed runtime events. */
export const deriveDelegationActivity = (progress: StreamProgressSnapshot): string | null => {
  for (const group of [...progress.commandGroups].reverse()) {
    const running = group.commands.find((command) => command.status === "running");
    if (running) return truncateActivity(`Running ${running.command}`);
  }
  const lastTextLine = progress.content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (lastTextLine) return truncateActivity(lastTextLine);
  if (progress.thinking.trim()) return "Reasoning";
  return null;
};

/** Publish one delegation-updated event; used by the finalization cascade too. */
export const publishDelegationUpdate = (
  sessionId: string,
  hostRunId: string,
  delegation: ChatDelegationRunDto,
): void => {
  publishChatSessionEvent({ type: "delegation-updated", sessionId, hostRunId, delegation });
};

export const toDelegationDto = (
  entry: ChatDelegationRun,
  host: {
    hostRunId: string;
    hostRunStatus: string;
    sessionId: string;
    sessionTitle: string | null;
  },
): ChatDelegationRunDto => ({
  ...entry,
  // A specialist can only be live while its host turn is running.
  status:
    entry.status === "active" && host.hostRunStatus !== "running" ? "cancelled" : entry.status,
  hostRunId: host.hostRunId,
  hostRunStatus: host.hostRunStatus,
  sessionId: host.sessionId,
  sessionTitle: host.sessionTitle,
});

const loadDelegationEntry = async (
  ctx: LocalServerContext,
  hostRunId: string,
  delegationId: string,
): Promise<ChatDelegationRun | null> => {
  const row = await ctx.db
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("id", "=", hostRunId)
    .executeTakeFirst();
  if (!row) return null;
  return (
    parseChatDelegationRuns(row.delegation_runs).find((entry) => entry.id === delegationId) ?? null
  );
};

const updateDelegationEntries = async (
  ctx: LocalServerContext,
  hostRun: { id: string; sessionId?: string },
  mutate: (entries: ChatDelegationRun[]) => ChatDelegationRun[],
): Promise<{ host: HostRunRef; entries: ChatDelegationRun[] } | null> =>
  // Post-work quick actions + progress notes race finish; serialize per host run.
  withHostDelegationLock(hostRun.id, () =>
    ctx.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom("chat_runs")
        .select(["delegation_runs", "session_id", "status"])
        .where("id", "=", hostRun.id)
        .executeTakeFirst();
      if (!row) return null;
      let next = mutate(parseChatDelegationRuns(row.delegation_runs));
      // Host already terminal: never leave (or resurrect) active specialist rows.
      if (row.status !== "running") {
        const now = new Date().toISOString();
        next = next.map((entry) =>
          entry.status === "active" ? { ...entry, status: "cancelled", updatedAt: now } : entry,
        );
      }
      await trx
        .updateTable("chat_runs")
        .set({ delegation_runs: serializeChatDelegationRuns(next) })
        .where("id", "=", hostRun.id)
        .execute();
      return { host: { id: hostRun.id, sessionId: row.session_id }, entries: next };
    }),
  );

const publishDelegation = async (
  ctx: LocalServerContext,
  hostRun: HostRunRef,
  entry: ChatDelegationRun,
): Promise<void> => {
  const [run, session] = await Promise.all([
    ctx.db.selectFrom("chat_runs").select("status").where("id", "=", hostRun.id).executeTakeFirst(),
    ctx.db
      .selectFrom("chat_sessions")
      .select("title")
      .where("id", "=", hostRun.sessionId)
      .executeTakeFirst(),
  ]);
  publishDelegationUpdate(
    hostRun.sessionId,
    hostRun.id,
    toDelegationDto(entry, {
      hostRunId: hostRun.id,
      hostRunStatus: run?.status ?? "running",
      sessionId: hostRun.sessionId,
      sessionTitle: session?.title ?? null,
    }),
  );
};

const truncateActivity = (value: string): string =>
  value.length <= ACTIVITY_MAX_LENGTH ? value : `${value.slice(0, ACTIVITY_MAX_LENGTH - 1)}…`;
