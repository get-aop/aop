import {
  ACTIVITY_DETAIL_MAX_LENGTH,
  ACTIVITY_LABEL_MAX_LENGTH,
  ACTIVITY_NARRATION_MAX_LENGTH,
  ACTIVITY_ROWS_PER_TURN_MAX,
  ACTIVITY_TURNS_MAX,
  type ActivityGroup,
  type ActivityRow,
  type ThreadActivity,
  type ThreadTurnActivity,
} from "@aop/common";
import { z } from "zod";
import { getLatestChatSessionProgress } from "../chat-session/session-events.ts";
import type { LocalServerContext } from "../context.ts";
import { displayText } from "../project/wire-messages.ts";
import type { ThreadResult } from "./types.ts";

/**
 * How many finished turns are looked at to find the latest ones that did something: most turns
 * of a thread that only talk have nothing to show, and must not use up the answer's turns.
 */
const SCANNED_TURNS = 100;

/**
 * What a thread did besides talking: the tool calls and status paragraphs of its latest turns.
 * The engine keeps both with each finished turn and in memory for the running one, and neither
 * is on the wire with the messages, so the transcript reads them here. Tool output and reasoning
 * are never returned: they can be large, and the person did not ask for them.
 */
export const readThreadActivity = async (
  ctx: LocalServerContext,
  threadId: string,
): Promise<ThreadResult<{ activity: ThreadActivity }>> => {
  if (!(await ctx.threadRepository.getById(threadId))) {
    return { success: false, error: { code: "THREAD_NOT_FOUND" } };
  }
  const finished = await finishedTurns(ctx, threadId);
  const running = await runningTurn(ctx, threadId);
  const turns = [...finished, ...(running ? [running] : [])].slice(-ACTIVITY_TURNS_MAX);
  return { success: true, activity: { turns } };
};

// Oldest first, the way the transcript reads.
const finishedTurns = async (
  ctx: LocalServerContext,
  threadId: string,
): Promise<ThreadTurnActivity[]> => {
  const rows = await ctx.db
    .selectFrom("chat_messages")
    .select(["id", "session_id", "content", "activity"])
    .where("session_id", "=", threadId)
    .where("role", "=", "assistant")
    .where("activity", "is not", null)
    .orderBy("turn_index", "desc")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(SCANNED_TURNS)
    .execute();
  const turns = rows.flatMap((row) => {
    const stored = parseStoredActivity(row.activity);
    if (!stored) return [];
    const turn: ThreadTurnActivity = {
      messageId: row.id,
      running: false,
      narration: narrationOf(stored.content, displayText(row)),
      groups: groupsOf(stored.commandGroups),
    };
    return isEmpty(turn) ? [] : [turn];
  });
  return turns.slice(0, ACTIVITY_TURNS_MAX).reverse();
};

// The running turn's paragraphs are the live text the stream already carries, so only its tool
// calls are returned: showing them twice would print the same words above and below.
const runningTurn = async (
  ctx: LocalServerContext,
  threadId: string,
): Promise<ThreadTurnActivity | null> => {
  const run = await ctx.db
    .selectFrom("chat_runs")
    .select("assistant_message_id")
    .where("session_id", "=", threadId)
    .where("status", "=", "running")
    .executeTakeFirst();
  const progress = run ? getLatestChatSessionProgress(threadId) : null;
  if (!run || !progress) return null;
  const turn: ThreadTurnActivity = {
    messageId: run.assistant_message_id,
    running: true,
    narration: "",
    groups: groupsOf(progress.commandGroups),
  };
  return isEmpty(turn) ? null : turn;
};

const isEmpty = (turn: ThreadTurnActivity): boolean =>
  turn.narration === "" && turn.groups.length === 0;

// A row or group written by another build, or by hand, is skipped: one of them must not make the
// rest of a thread's activity unreadable.
const StoredRowSchema = z.object({
  id: z.string().min(1),
  command: z.string().trim().min(1),
  detail: z.string().nullish(),
  status: z.enum(["running", "done", "failed"]),
});
const StoredGroupSchema = z.object({ id: z.string().min(1), commands: z.array(z.unknown()) });
const StoredActivitySchema = z.object({
  content: z.string().catch(""),
  commandGroups: z.array(z.unknown()).catch([]),
});

const parseStoredActivity = (raw: string | null) => {
  try {
    const parsed = StoredActivitySchema.safeParse(JSON.parse(raw ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** The batches of tool calls, keeping the latest rows when a turn made more than a page can hold. */
const groupsOf = (commandGroups: readonly unknown[]): ActivityGroup[] => {
  let room = ACTIVITY_ROWS_PER_TURN_MAX;
  const kept: ActivityGroup[] = [];
  for (const raw of [...commandGroups].reverse()) {
    const group = StoredGroupSchema.safeParse(raw);
    if (!group.success) continue;
    const rows = group.data.commands.flatMap(rowOf).slice(-room);
    if (rows.length === 0) continue;
    room -= rows.length;
    kept.unshift({ id: group.data.id, rows });
    if (room === 0) break;
  }
  return kept;
};

const rowOf = (raw: unknown): ActivityRow[] => {
  const row = StoredRowSchema.safeParse(raw);
  if (!row.success) return [];
  const detail = row.data.detail?.trim();
  return [
    {
      id: row.data.id,
      label: firstChars(row.data.command, ACTIVITY_LABEL_MAX_LENGTH),
      detail: detail ? firstChars(detail, ACTIVITY_DETAIL_MAX_LENGTH) : null,
      status: row.data.status,
    },
  ];
};

// The stored content is the paragraphs said while working followed by the final answer (see
// finalizeActivityContent), and the final answer is the message itself. A turn that was stopped
// has no such ending, and its content is left out rather than risk repeating the message.
const narrationOf = (content: string, finalText: string): string => {
  const said = content.trimEnd();
  const final = finalText.trim();
  if (!said.endsWith(final)) return "";
  return lastChars(said.slice(0, said.length - final.length).trim(), ACTIVITY_NARRATION_MAX_LENGTH);
};

const firstChars = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

// What was said last is what matters when a turn said more than fits.
const lastChars = (text: string, max: number): string =>
  text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;
