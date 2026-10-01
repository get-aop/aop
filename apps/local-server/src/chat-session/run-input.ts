import { randomUUID } from "node:crypto";
import { getLogger, typeIdToUuid } from "@aop/infra";
import {
  buildClaudeUserMessage,
  endInput,
  type InputChannel,
  isInputSettled,
  parseRawJsonlContent,
  replayedUuid,
  writeInputLine,
} from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { ChatMessage, ChatRun, ChatSession } from "../db/schema.ts";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import { createKeyedQueue } from "../thread/keyed-queue.ts";
import {
  buildRuntimePrompt,
  decodeStoredAttachmentMetadata,
  runImagesOf,
} from "./message-images.ts";
import { CHAT_MAX_LOG_BYTES, readBoundedUtf8File } from "./runtime-engine.ts";

/**
 * Messages that reach a turn while it runs. A Claude Code run reads more user messages from a
 * FIFO next to its log (`chat_runs.input_path`; see claude-code-input-channel.ts in
 * @aop/llm-provider). A message written there belongs to that run (`steered_run_id`): the model
 * takes it in after the tool call it is on, or, when it arrives as the answer is written, in
 * another turn of the same process, and the run's reply shows it where it was taken. Once the
 * run has answered everything it was given, its input ends and the CLI exits.
 *
 * Writing to a run and ending its input go one at a time per run, so a message is never written
 * to a run that is ending, and a run never ends with a message on its way. A message that cannot
 * be written (the run is ending, gone, or takes none) waits for a turn of its own, as before.
 */

const logger = getLogger("aop", "chat-run-input");

const perRun = createKeyedQueue();
/** Runs whose input this host ended: nothing more is written to them. */
const endedInputs = new Set<string>();

/** Where a run of this session reads steers from, or null for a runtime that takes none. */
export const inputChannelFor = (
  session: Pick<ChatSession, "runtime">,
  run: Pick<ChatRun, "log_file_path" | "user_message_id">,
): InputChannel | null =>
  session.runtime === "claude-code" && process.platform !== "win32"
    ? { path: `${run.log_file_path}.in`, promptUuid: promptUuidOf(run) }
    : null;

/** The uuid the run's prompt is sent with: its message's own, when its id has one. */
export const promptUuidOf = (run: Pick<ChatRun, "user_message_id">): string =>
  typeIdToUuid(run.user_message_id) ?? randomUUID();

/** Records the run's input before its CLI starts, so a restarted host can still write to it. */
export const recordRunInput = async (
  ctx: LocalServerContext,
  runId: string,
  channel: InputChannel,
): Promise<void> => {
  await ctx.db
    .updateTable("chat_runs")
    .set({ input_path: channel.path })
    .where("id", "=", runId)
    .where("status", "=", "running")
    .execute();
};

/**
 * Writes a stored user message into the session's running turn. Returns the run it went to, or
 * null when no running turn takes it: the message then waits for a turn of its own.
 */
export const deliverToRunningTurn = async (
  ctx: LocalServerContext,
  session: ChatSession,
  message: ChatMessage,
): Promise<ChatRun | null> => {
  const run = await runningRunWithInput(ctx, session.id);
  const uuid = typeIdToUuid(message.id);
  if (!run?.input_path || !uuid) return null;
  const inputPath = run.input_path;
  return perRun(run.id, async () => {
    if (endedInputs.has(run.id) || !(await isStillRunning(ctx, run.id))) return null;
    if (await hasRun(ctx, message.id)) return null;
    if (!(await writeInputLine(inputPath, steerLine(session.id, message, uuid)))) return null;
    // Only onto a run that has not ended meanwhile: a run's end puts back what it did not take,
    // and one that ended before this line was linked would never see it.
    const linked = await ctx.eventPublisher.transaction(async (tx) => {
      const row = await tx.db
        .updateTable("chat_messages")
        .set({ steered_run_id: run.id, disposition: "steered" })
        .where("id", "=", message.id)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("chat_runs")
              .select("id")
              .where("id", "=", run.id)
              .where("status", "=", "running"),
          ),
        )
        .returningAll()
        .executeTakeFirst();
      if (row) await ctx.sessionHooks.onUserMessageChanged(tx, row);
      return row;
    });
    if (!linked) return null;
    logger.info("Steered message {messageId} into run {runId}", {
      messageId: message.id,
      runId: run.id,
    });
    return run;
  });
};

/**
 * Ends a run's input once it has answered everything it was given: the CLI then exits after its
 * last answer. Called whenever the run writes a result. True once the input is ended.
 */
export const settleRunInput = async (ctx: LocalServerContext, runId: string): Promise<boolean> =>
  perRun(runId, async () => {
    if (endedInputs.has(runId)) return true;
    const run = await ctx.db
      .selectFrom("chat_runs")
      .selectAll()
      .where("id", "=", runId)
      .executeTakeFirst();
    if (!run?.input_path || run.status !== "running") return false;
    const events = await readRunEvents(run.log_file_path);
    if (!isInputSettled(events, await steerUuids(ctx, runId))) return false;
    endedInputs.add(runId);
    if (run.pid !== null) endInput(run.pid);
    return true;
  });

/** Whether this host already ended the run's input. */
export const isRunInputEnded = (runId: string): boolean => endedInputs.has(runId);

/**
 * At a run's end, in the transaction that finalizes it: the messages written into it that the
 * CLI took are its own. One it never took goes back in line for a turn of its own, unless the
 * run was stopped: what was sent to a stopped turn is dropped with it, as a queue is, and stays
 * in its reply. Returns the messages put back in line.
 */
export const releaseUntakenSteers = async (
  tx: PublisherTransaction,
  ctx: LocalServerContext,
  run: ChatRun,
  {
    stopped,
    notify,
  }: {
    stopped: boolean;
    /** Tell the project domain; false when its hooks failed and the run is finalized without them. */
    notify: boolean;
  },
): Promise<ChatMessage[]> => {
  endedInputs.delete(run.id);
  const linked = await tx.db
    .selectFrom("chat_messages")
    .selectAll()
    .where("steered_run_id", "=", run.id)
    .execute();
  if (linked.length === 0) return [];
  const taken = takenUuids(await readRunEvents(run.log_file_path));
  const released: ChatMessage[] = [];
  for (const message of linked) {
    const back = !stopped && !taken.has(typeIdToUuid(message.id) ?? message.id);
    const changed = await tx.db
      .updateTable("chat_messages")
      .set(back ? { steered_run_id: null, disposition: "queued" } : { disposition: "immediate" })
      .where("id", "=", message.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (!back) continue;
    released.push(changed);
    if (notify) await ctx.sessionHooks.onUserMessageChanged(tx, changed);
  }
  return released;
};

/** The stream-json line of a steer: the message as the person wrote it, with its attachments. */
const steerLine = (sessionId: string, message: ChatMessage, uuid: string): string => {
  const decoded = decodeStoredAttachmentMetadata(message.content);
  const prompt = buildRuntimePrompt(
    decoded.text,
    sessionId,
    decoded.images,
    decoded.documents,
    decoded.pastes,
    null,
    [],
  ).trim();
  return buildClaudeUserMessage(prompt, runImagesOf(sessionId, decoded.images), undefined, uuid);
};

const runningRunWithInput = (ctx: LocalServerContext, sessionId: string) =>
  ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .where("input_path", "is not", null)
    .executeTakeFirst();

const isStillRunning = async (ctx: LocalServerContext, runId: string): Promise<boolean> =>
  (await ctx.db.selectFrom("chat_runs").select("status").where("id", "=", runId).executeTakeFirst())
    ?.status === "running";

// A message a turn was already started for (a queued turn the dispatcher took meanwhile).
const hasRun = async (ctx: LocalServerContext, messageId: string): Promise<boolean> =>
  Boolean(
    await ctx.db
      .selectFrom("chat_runs")
      .select("id")
      .where("user_message_id", "=", messageId)
      .executeTakeFirst(),
  );

const steerUuids = async (ctx: LocalServerContext, runId: string): Promise<string[]> =>
  (
    await ctx.db
      .selectFrom("chat_messages")
      .select("id")
      .where("steered_run_id", "=", runId)
      .execute()
  ).flatMap((row) => typeIdToUuid(row.id) ?? []);

const readRunEvents = async (logFilePath: string) =>
  parseRawJsonlContent(
    (await readBoundedUtf8File(logFilePath, CHAT_MAX_LOG_BYTES)) ?? "",
  ).entries.map((entry) => entry.event);

const takenUuids = (events: Awaited<ReturnType<typeof readRunEvents>>): Set<string> =>
  new Set(events.flatMap((event) => replayedUuid(event) ?? []));
