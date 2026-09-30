import type { Thread, ThreadStatus } from "@aop/common";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import { createEventLogRepository } from "../event-log/repository.ts";
import { eventually, type ProjectStack } from "../project/test-utils.ts";
import { SettingKey } from "../settings/types.ts";
import { coordinatorInbox } from "../thread/test-utils.ts";
import { countRunningThreadRuns } from "./capacity.ts";

export const setRunCap = (s: ProjectStack, cap: number): Promise<void> =>
  s.ctx.settingsRepository.set(SettingKey.MAX_CONCURRENT_RUNS, String(cap));

/** A thread spawned on the fake CLI; its turn is whatever `[fake: ...]` marker `prompt` carries. */
export const spawnThread = async (
  s: ProjectStack,
  projectId: string,
  prompt: string,
): Promise<Thread> => {
  // The title leaves the marker out: the coordinator's briefing lists thread titles, and a marker
  // in one would script the coordinator's own turns.
  const title = prompt.replace(/\[fake:[^\]]*\]/g, "").trim() || "Thread";
  const spawned = await s.services.threads.spawn(projectId, { title, prompt });
  if (!spawned.success) throw new Error(`thread not spawned: ${JSON.stringify(spawned.error)}`);
  return spawned.thread;
};

export const threadOf = async (s: ProjectStack, threadId: string): Promise<Thread> => {
  const found = await s.services.threads.get(threadId);
  if (!found.success) throw new Error(`thread ${threadId} not found`);
  return found.thread;
};

export const statusesOf = async (s: ProjectStack, threadIds: string[]): Promise<ThreadStatus[]> =>
  Promise.all(threadIds.map(async (id) => (await threadOf(s, id)).status));

export const untilStatus = (s: ProjectStack, threadId: string, status: ThreadStatus) =>
  eventually(async () => {
    const thread = await threadOf(s, threadId);
    return thread.status === status ? thread : undefined;
  }, `thread ${threadId} to be ${status}`);

/** The outcomes of the thread reports that reached the project's coordinator, in order. */
export const coordinatorReports = async (s: ProjectStack, projectId: string): Promise<string[]> => {
  const inbox = await coordinatorInbox(s, projectId);
  return inbox.flatMap((row) => {
    const origin = parseMessageOrigin(row.origin_json);
    return origin?.type === "thread-report" ? [origin.outcome] : [];
  });
};

/**
 * The chat session each provider run the engine started belonged to, in start order, limited to
 * `sessionIds` when given: a finished thread wakes its project's coordinator, whose runs a test
 * about threads does not want in the list.
 */
export const runOrder = (s: ProjectStack, sessionIds?: string[]): string[] =>
  s.runs
    .map((run) => run.env?.AOP_CHAT_SESSION_ID ?? "")
    .filter((id) => !sessionIds || sessionIds.includes(id));

/** Resolves once the engine has started `count` provider runs for `sessionId`. */
export const untilStarted = (s: ProjectStack, sessionId: string, count = 1) =>
  eventually(
    async () => (runOrder(s, [sessionId]).length >= count ? true : undefined),
    `${count} run(s) of ${sessionId} to start`,
  );

/**
 * Samples how many thread runs are going, every few milliseconds, until stopped. The cap is an
 * invariant, so a test asserts it over the whole run instead of at the moments it thought of.
 */
export const watchRunning = (s: ProjectStack) => {
  let peak = 0;
  let stopped = false;
  const sampling = (async () => {
    while (!stopped) {
      peak = Math.max(peak, await countRunningThreadRuns(s.db));
      await Bun.sleep(5);
    }
  })();
  return {
    stop: async (): Promise<number> => {
      stopped = true;
      await sampling;
      return peak;
    },
  };
};

/** A user message with no run yet: a turn waiting in the queue. */
export const insertQueuedMessage = async (
  db: ProjectStack["db"],
  sessionId: string,
  createdAt: string,
  id = `msg-${sessionId}-${createdAt}`,
): Promise<string> => {
  await db
    .insertInto("chat_messages")
    .values({
      id,
      session_id: sessionId,
      role: "user",
      content: "work",
      turn_index: 1,
      disposition: "queued",
      created_at: createdAt,
      origin_json: null,
    })
    .execute();
  return id;
};

/** A run for `messageId` in the given state; `running` occupies one of the host's slots. */
export const insertRun = async (
  db: ProjectStack["db"],
  sessionId: string,
  messageId: string,
  status: "running" | "completed",
): Promise<void> => {
  await db
    .insertInto("chat_runs")
    .values({
      id: `run-${messageId}`,
      session_id: sessionId,
      user_message_id: messageId,
      assistant_message_id: `reply-${messageId}`,
      runtime: "claude-code",
      log_file_path: "run.jsonl",
      status,
      runtime_session_id: null,
      resume_session_id: null,
      failure_kind: null,
      interruption_kind: null,
      context_strategy: "fresh",
      workspace_path: null,
      timeout_policy: null,
      retry_of_run_id: null,
      runtime_session_state: null,
      error_message: null,
      pid: null,
    })
    .execute();
};

/** Every event a project's stream carried for one thread, as `type:status` in order. */
export const threadEvents = async (
  s: ProjectStack,
  projectId: string,
  threadId: string,
): Promise<string[]> =>
  (await createEventLogRepository(s.db).listAfter(projectId, 0)).flatMap((entry) =>
    entry.type === "thread.upserted" && entry.payload.thread.id === threadId
      ? [entry.payload.thread.status]
      : [],
  );
