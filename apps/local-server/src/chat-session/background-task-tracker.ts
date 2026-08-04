import { writeFile } from "node:fs/promises";
import { parseChatDelegationRuns } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { ChatRun, ChatSession } from "../db/schema.ts";
import {
  deriveDelegationActivity,
  finishDelegationRun,
  noteDelegationActivity,
  startDelegationRun,
} from "./delegation-runs.ts";
import { createSessionRunLogPath } from "./runtime-engine.ts";
import { publishChatSessionEvent } from "./session-events.ts";
import type { StreamCommandRow, StreamProgressSnapshot } from "./stream-progress.ts";

/** Exact normalized names that are always background/subagent tools. */
const BACKGROUND_TASK_TOOLS = new Set(["task", "agent"]);

/**
 * Substrings that mark provider-specific agent/task labels after whitespace
 * is stripped (e.g. "Collab agent tool call" → collabagenttoolcall).
 */
const BACKGROUND_TASK_PATTERNS = [
  /subagent/,
  /backgroundtask/,
  /agenttool/,
  /tasktool/,
  /collabagent/,
  /spawnagent/,
  /spawnsubagent/,
  /tasktoolcall/,
  /agenttoolcall/,
];

/** Ordinary tools that must never surface as background-task cards. */
const ORDINARY_TOOLS = new Set([
  "bash",
  "shell",
  "sh",
  "zsh",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "webfetch",
  "websearch",
  "question",
  "skill",
  "tool",
]);

const PROGRESS_PUBLISH_INTERVAL_MS = 500;

export interface BackgroundTaskHost {
  ctx: LocalServerContext;
  hostRun: ChatRun;
  session: ChatSession;
}

export interface BackgroundTaskTracker {
  (progress: StreamProgressSnapshot): void;
  flush: () => Promise<void>;
}

interface TrackedBackgroundTask {
  delegationId: string;
  status: "active" | "terminal";
  logFilePath: string;
  label: string;
  lastContent: string;
  lastPublishAt: number;
}

/**
 * True for Task/Agent-style tools that should surface as floating cards.
 * Ordinary tools (Bash, Read, …) stay in the host activity stream only.
 */
export const isBackgroundTaskToolName = (name: string): boolean => {
  const raw = name.trim().toLowerCase();
  if (!raw) return false;
  const compact = raw.replace(/[\s_.-]+/g, "");
  if (ORDINARY_TOOLS.has(compact)) return false;
  if (BACKGROUND_TASK_TOOLS.has(compact)) return true;
  if (BACKGROUND_TASK_PATTERNS.some((pattern) => pattern.test(compact))) return true;
  // Multi-word provider labels: "Collab agent tool call", "Task (explore)", etc.
  const tokens = raw.split(/[\s_./:()[\]-]+/).filter(Boolean);
  return tokens.some((token) => token === "agent" || token === "task" || token === "subagent");
};

/** Rows in a progress snapshot that represent background Task/Agent work. */
export const extractBackgroundTaskRows = (progress: StreamProgressSnapshot): StreamCommandRow[] =>
  progress.commandGroups.flatMap((group) =>
    group.commands.filter((row) => isBackgroundTaskToolName(row.command)),
  );

/**
 * Watch host stream progress and project Task/Agent tools into the shared
 * delegation card registry (kind `background-task`).
 */
export const createBackgroundTaskTracker = (host: BackgroundTaskHost): BackgroundTaskTracker => {
  const known = new Map<string, TrackedBackgroundTask>();
  let seedPromise: Promise<void> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const seed = (): Promise<void> => {
    if (!seedPromise) seedPromise = seedKnownFromHost(host, known);
    return seedPromise;
  };

  const track = (progress: StreamProgressSnapshot): void => {
    queue = queue
      .then(() => seed())
      .then(() => applyBackgroundTaskProgress(host, known, progress))
      .catch(() => {});
  };
  track.flush = () => queue;
  return track;
};

const seedKnownFromHost = async (
  host: BackgroundTaskHost,
  known: Map<string, TrackedBackgroundTask>,
): Promise<void> => {
  const row = await host.ctx.db
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("id", "=", host.hostRun.id)
    .executeTakeFirst();
  if (!row) return;
  for (const entry of parseChatDelegationRuns(row.delegation_runs)) {
    if (entry.kind !== "background-task" || !entry.toolUseId) continue;
    known.set(entry.toolUseId, {
      delegationId: entry.id,
      status: entry.status === "active" ? "active" : "terminal",
      logFilePath: entry.logFilePath,
      label: entry.label,
      lastContent: "",
      lastPublishAt: 0,
    });
  }
};

const applyBackgroundTaskProgress = async (
  host: BackgroundTaskHost,
  known: Map<string, TrackedBackgroundTask>,
  progress: StreamProgressSnapshot,
): Promise<void> => {
  for (const row of extractBackgroundTaskRows(progress)) {
    if (row.status === "running") {
      await ensureBackgroundTaskStarted(host, known, row, progress);
      continue;
    }
    await ensureBackgroundTaskFinished(host, known, row, progress);
  }
};

const ensureBackgroundTaskStarted = async (
  host: BackgroundTaskHost,
  known: Map<string, TrackedBackgroundTask>,
  row: StreamCommandRow,
  progress: StreamProgressSnapshot,
): Promise<void> => {
  const existing = known.get(row.id);
  if (existing) {
    if (existing.status === "active") {
      await publishBackgroundTaskProgress(host, existing, row, progress, "running");
    }
    return;
  }

  const { session, hostRun, ctx } = host;
  const label = backgroundTaskLabel(row);
  const logFilePath = await createSessionRunLogPath(`${session.id}-bg`);
  const entry = await startDelegationRun(ctx, hostRun, {
    kind: "background-task",
    label,
    runtime: session.runtime,
    runtimeAlias: session.runtime_alias,
    runtimeConfigurationId: session.runtime_configuration_id,
    model: session.model,
    reasoning: session.reasoning_effort,
    fastMode: session.fast_mode,
    logFilePath,
    toolUseId: row.id,
  });
  const tracked: TrackedBackgroundTask = {
    delegationId: entry.id,
    status: "active",
    logFilePath,
    label,
    lastContent: "",
    lastPublishAt: 0,
  };
  known.set(row.id, tracked);
  await publishBackgroundTaskProgress(host, tracked, row, progress, "running");
};

const ensureBackgroundTaskFinished = async (
  host: BackgroundTaskHost,
  known: Map<string, TrackedBackgroundTask>,
  row: StreamCommandRow,
  progress: StreamProgressSnapshot,
): Promise<void> => {
  let tracked = known.get(row.id);
  if (!tracked) {
    // Tool completed in the same snapshot batch as start (or after reconnect).
    await ensureBackgroundTaskStarted(host, known, { ...row, status: "running" }, progress);
    tracked = known.get(row.id);
  }
  if (!tracked || tracked.status === "terminal") return;

  const failed = row.status === "failed";
  await publishBackgroundTaskProgress(
    host,
    tracked,
    row,
    progress,
    failed ? "failed" : "completed",
  );
  await finishDelegationRun(host.ctx, host.hostRun.id, tracked.delegationId, {
    status: failed ? "failed" : "completed",
    error: failed ? "Background task failed." : null,
  });
  known.set(row.id, { ...tracked, status: "terminal" });
};

const publishBackgroundTaskProgress = async (
  host: BackgroundTaskHost,
  tracked: TrackedBackgroundTask,
  row: StreamCommandRow,
  progress: StreamProgressSnapshot,
  phase: "running" | "completed" | "failed",
): Promise<void> => {
  const content = buildBackgroundTaskContent(tracked.label, row, progress, phase);
  const activity = backgroundTaskActivity(row, progress, phase);
  const now = Date.now();
  const throttled =
    phase === "running" &&
    content === tracked.lastContent &&
    now - tracked.lastPublishAt < PROGRESS_PUBLISH_INTERVAL_MS;
  if (throttled) return;

  tracked.lastContent = content;
  tracked.lastPublishAt = now;
  await writeBackgroundTaskLog(tracked.logFilePath, content);
  await noteDelegationActivity(host.ctx, host.hostRun.id, tracked.delegationId, activity);
  publishChatSessionEvent({
    type: "delegation-progress",
    sessionId: host.hostRun.session_id,
    delegationId: tracked.delegationId,
    thinking: "",
    content,
    commandGroups: [],
  });
};

/** Human-readable body for the detail panel + persisted log. */
export const buildBackgroundTaskContent = (
  label: string,
  row: StreamCommandRow,
  progress: StreamProgressSnapshot,
  phase: "running" | "completed" | "failed",
): string => {
  const sections = [
    `## ${label}`,
    ...optionalDetailSection(label, row),
    ...phaseSections(row, progress, phase),
  ];
  return sections.join("\n\n");
};

const optionalDetailSection = (label: string, row: StreamCommandRow): string[] => {
  const detail = row.detail?.trim();
  return detail && detail !== label ? [detail] : [];
};

const phaseSections = (
  row: StreamCommandRow,
  progress: StreamProgressSnapshot,
  phase: "running" | "completed" | "failed",
): string[] => {
  if (phase === "running") return runningSections(progress);
  if (phase === "failed") return ["Status: failed", ...resultSection(row)];
  return ["Status: completed", ...resultSection(row)];
};

const runningSections = (progress: StreamProgressSnapshot): string[] => {
  const hostActivity = deriveDelegationActivity(progress);
  const sections = [hostActivity ? `Status: running — ${hostActivity}` : "Status: running"];
  const hostSnippet = latestHostContentSnippet(progress.content);
  if (hostSnippet) sections.push(`Host activity:\n${hostSnippet}`);
  return sections;
};

const resultSection = (row: StreamCommandRow): string[] => {
  const result = row.result?.trim();
  return result ? [`## Result\n\n${result}`] : [];
};

const backgroundTaskActivity = (
  row: StreamCommandRow,
  progress: StreamProgressSnapshot,
  phase: "running" | "completed" | "failed",
): string => {
  if (phase === "failed") return "Failed";
  if (phase === "completed") return "Completed";
  return deriveDelegationActivity(progress) ?? row.detail?.trim() ?? "Running";
};

const latestHostContentSnippet = (content: string, max = 600): string | null => {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(trimmed.length - max + 1)}`;
};

const writeBackgroundTaskLog = async (logFilePath: string, content: string): Promise<void> => {
  if (!logFilePath) return;
  // Single text event so readDelegationOutput rebuilds a clean snapshot after refresh.
  await writeFile(logFilePath, `${JSON.stringify({ type: "text", data: content })}\n`, "utf8");
};

const backgroundTaskLabel = (row: StreamCommandRow): string => {
  const detail = row.detail?.trim();
  if (detail) return detail;
  const tool = row.command.trim() || "Task";
  return tool.charAt(0).toUpperCase() + tool.slice(1);
};
