import { generateTypeId, getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import type { LocalServerContext } from "../context.ts";
import type { ChatMessage, ChatRun, ChatSession, Database } from "../db/schema.ts";
import { decodeStoredAttachmentMetadata } from "./message-images.ts";
import { parseMessageOrigin } from "./message-origin.ts";
import { coordinatorWakeTasks } from "./reply-state.ts";

const logger = getLogger("chat-session", "report-batch");

/*
 * Threads often finish together (a coordinator fans work out, so its threads end within seconds of
 * each other). Waking the coordinator once per report would run it N times, each answering a
 * report that the next one is about to supersede. Two things make it one run:
 *
 * - Waking waits a short quiet window, restarted by every report that arrives in it.
 * - A run that starts takes every report waiting in the inbox, in order, as one turn.
 *
 * Both are only a timing choice over the durable queue: a report is a stored message either way,
 * so a crash or restart during the window loses nothing, and boot starts whatever is waiting.
 */

/** How long the coordinator's inbox stays quiet before its reports are read. */
export const COORDINATOR_WAKE_WINDOW_MS = 2_000;

// A steady trickle of reports must not keep the coordinator from ever answering.
const MAX_WAIT_WINDOWS = 5;

interface PendingWake {
  timer?: ReturnType<typeof setTimeout>;
  firstAt: number;
  done: Promise<void>;
  finish: () => void;
}

const pendingWakes = new Map<string, PendingWake>();

/**
 * Runs `wake` once the session's inbox has been quiet for `windowMs`; each call inside the window
 * restarts it, up to `windowMs * 5` after the first. A zero window wakes at once.
 */
export const scheduleCoordinatorWake = (
  sessionId: string,
  windowMs: number,
  wake: () => Promise<void>,
): void => {
  if (windowMs <= 0) {
    const task = wake().catch(logWakeFailure(sessionId));
    coordinatorWakeTasks.add(task);
    void task.finally(() => coordinatorWakeTasks.delete(task));
    return;
  }
  const now = Date.now();
  const pending = pendingWakes.get(sessionId) ?? openWake(now);
  clearTimeout(pending.timer);
  const wait = Math.min(windowMs, pending.firstAt + windowMs * MAX_WAIT_WINDOWS - now);
  pending.timer = setTimeout(
    () => {
      pendingWakes.delete(sessionId);
      void wake().catch(logWakeFailure(sessionId)).finally(pending.finish);
    },
    Math.max(0, wait),
  );
  pendingWakes.set(sessionId, pending);
};

/** Drops every waiting wake without running it; the reports stay stored and start at boot. */
export const cancelCoordinatorWakes = (): void => {
  for (const pending of pendingWakes.values()) {
    clearTimeout(pending.timer);
    pending.finish();
  }
  pendingWakes.clear();
};

/**
 * The reports one coordinator run answers: the oldest waiting message when it is a thread report,
 * and every report stored right behind it. A message from the person ends the batch, so the
 * coordinator reads things in the order they happened and the person's message gets its own turn.
 */
export const loadReportBatch = async (
  ctx: LocalServerContext,
  oldest: ChatMessage,
): Promise<ChatMessage[]> => {
  if (!isThreadReport(oldest)) return [oldest];
  const waiting = await ctx.db
    .selectFrom("chat_messages")
    .selectAll()
    .where("session_id", "=", oldest.session_id)
    .where("role", "=", "user")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("chat_runs")
            .select("id")
            .whereRef("chat_runs.user_message_id", "=", "chat_messages.id"),
        ),
      ),
    )
    .orderBy("turn_index", "asc")
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .execute();
  const batch: ChatMessage[] = [];
  for (const message of waiting) {
    if (!isThreadReport(message)) break;
    batch.push(message);
  }
  return batch.length > 0 ? batch : [oldest];
};

/**
 * What the session's next run answers. Reports waiting in a coordinator's inbox are answered by
 * one run: `decoded` is all their text, oldest first. The newest report carries the run (`queued`),
 * because the reply takes its place in the conversation, so it reads after every report it
 * answers; the others are `alsoAnswered`, consumed with the run. Any other turn is its one message.
 */
export const readNextTurn = async (
  ctx: LocalServerContext,
  session: ChatSession,
  oldest: ChatMessage,
) => {
  const batch = session.kind === "coordinator" ? await loadReportBatch(ctx, oldest) : [oldest];
  const queued = batch.at(-1) ?? oldest;
  const stored = decodeStoredAttachmentMetadata(queued.content);
  const decoded = batch.length > 1 ? { ...stored, text: reportBatchText(batch) } : stored;
  return { queued, alsoAnswered: batch.slice(0, -1), decoded };
};

/** What the coordinator reads for a batch: a lone report as written, several numbered in order. */
export const reportBatchText = (batch: readonly ChatMessage[]): string => {
  const texts = batch.map((message) => decodeStoredAttachmentMetadata(message.content).text);
  if (texts.length === 1) return texts[0] ?? "";
  const reports = texts.map((text, index) => `Report ${index + 1} of ${texts.length}:\n${text}`);
  return [
    `${texts.length} thread reports arrived together, oldest first. Read them all before you act, and answer them in one reply.`,
    ...reports,
  ].join("\n\n---\n\n");
};

/**
 * Marks the other reports of a batch as answered, in the transaction that claims the run which
 * answers them. A message stops waiting when it has a run, so each gets a finished one that points
 * at the batch's run log and has no reply of its own; they are consumed if and only if the batch
 * is claimed, and a crash before that leaves all of them waiting.
 */
export const consumeAnsweredMessages = async (
  trx: Kysely<Database>,
  input: {
    alsoAnswered?: readonly ChatMessage[];
    session: ChatSession;
    sessionId: string;
    logFilePath: string;
    contextStrategy: ChatRun["context_strategy"];
    workspacePath: string | null;
    timeoutPolicy: string;
  },
  at: string,
): Promise<void> => {
  const answered = input.alsoAnswered ?? [];
  if (answered.length === 0) return;
  const { session } = input;
  await trx
    .insertInto("chat_runs")
    .values(
      answered.map((message) => ({
        id: generateTypeId("crun"),
        session_id: input.sessionId,
        user_message_id: message.id,
        assistant_message_id: generateTypeId("smsg"),
        runtime: session.runtime,
        log_file_path: input.logFilePath,
        status: "completed" as const,
        runtime_session_id: session.runtime_session_id,
        resume_session_id: session.runtime_session_id,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: input.contextStrategy,
        workspace_path: input.workspacePath,
        timeout_policy: input.timeoutPolicy,
        retry_of_run_id: null,
        runtime_session_state: null,
        error_message: null,
        created_at: at,
        updated_at: at,
      })),
    )
    .execute();
  await trx
    .updateTable("chat_messages")
    .set({ disposition: "immediate" })
    .where(
      "id",
      "in",
      answered.map(({ id }) => id),
    )
    .execute();
};

export const isThreadReport = (message: ChatMessage): boolean =>
  parseMessageOrigin(message.origin_json)?.type === "thread-report";

const openWake = (firstAt: number): PendingWake => {
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  coordinatorWakeTasks.add(done);
  void done.then(() => coordinatorWakeTasks.delete(done));
  return { firstAt, done, finish };
};

const logWakeFailure = (sessionId: string) => (error: unknown) => {
  logger.error("Waking the coordinator {sessionId} for its reports failed: {error}", {
    sessionId,
    error: String(error),
  });
};
