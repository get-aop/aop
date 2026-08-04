import type { ChatActionPayload, TaskStatus } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { Kysely } from "kysely";
import { toMinimalSessionDto } from "../chat-session/session-dto.ts";
import { publishChatSessionEvent } from "../chat-session/session-events.ts";
import { nextChatTurnIndex } from "../chat-session/turn-order.ts";
import type { Database } from "../db/schema.ts";

const NOTIFY_STATUSES = new Set<TaskStatus>(["DONE", "BLOCKED"]);

/** Persist the Sessions chat that originated a task (idempotent). */
export const linkTaskToOriginChatSession = async (
  db: Kysely<Database>,
  taskId: string,
  sessionId: string,
): Promise<void> => {
  const task = taskId.trim();
  const session = sessionId.trim();
  if (!task || !session) return;

  await db
    .updateTable("tasks")
    .set({ origin_chat_session_id: session })
    .where("id", "=", task)
    .where("origin_chat_session_id", "is", null)
    .execute();
};

/** Link every task id referenced by a chat card action to the given session. */
export const linkTasksFromChatAction = async (
  db: Kysely<Database>,
  sessionId: string,
  action: ChatActionPayload | null | undefined,
): Promise<void> => {
  for (const taskId of taskIdsFromChatAction(action)) {
    await linkTaskToOriginChatSession(db, taskId, sessionId);
  }
};

/**
 * When a task reaches Done or Blocked, post a system-style assistant note into
 * the Sessions chat that created it (if known).
 */
export const notifyOriginChatOfTaskStatus = async (
  db: Kysely<Database>,
  taskId: string,
  newStatus: TaskStatus,
  previousStatus: TaskStatus,
): Promise<void> => {
  if (!NOTIFY_STATUSES.has(newStatus) || previousStatus === newStatus) return;

  const task = await db.selectFrom("tasks").selectAll().where("id", "=", taskId).executeTakeFirst();
  if (!task) return;

  const sessionId =
    task.origin_chat_session_id ?? (await findOriginSessionFromChatHistory(db, taskId));
  if (!sessionId) return;

  if (!task.origin_chat_session_id) {
    await linkTaskToOriginChatSession(db, taskId, sessionId);
  }

  const session = await db
    .selectFrom("chat_sessions")
    .selectAll()
    .where("id", "=", sessionId)
    .executeTakeFirst();
  if (!session) return;

  const title = titleFromChangePath(task.change_path);
  const content = buildStatusMessage(title, newStatus);
  const messageId = generateTypeId("smsg");
  const createdAt = new Date().toISOString();
  const turnIndex = await nextChatTurnIndex(db, sessionId);
  const action = {
    type: "task" as const,
    id: task.id,
    label: newStatus === "DONE" ? "Task done" : "Task blocked",
    sub: title,
    meta: newStatus,
    status: "live" as const,
  };

  await db
    .insertInto("chat_messages")
    .values({
      id: messageId,
      session_id: sessionId,
      role: "assistant",
      content,
      action: JSON.stringify(action),
      activity: null,
      turn_index: turnIndex,
      created_at: createdAt,
    })
    .execute();

  await db
    .updateTable("chat_sessions")
    .set({ settled_override: null, settled_at: null, updated_at: createdAt })
    .where("id", "=", sessionId)
    .execute();

  const sessionDto = toMinimalSessionDto(
    { ...session, settled_override: null, settled_at: null },
    { snippet: content, updatedAt: createdAt },
  );
  publishChatSessionEvent({
    type: "assistant-final",
    sessionId,
    sessionTitle: session.title,
    message: {
      id: messageId,
      sessionId,
      role: "assistant",
      content,
      action,
      activity: null,
      createdAt,
      images: [],
      documents: [],
    },
  });
  publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });
};

export const taskIdsFromChatAction = (action: ChatActionPayload | null | undefined): string[] => {
  if (!action) return [];
  const ids = new Set<string>();
  addTaskId(ids, action.id);
  collectProposalTaskIds(ids, action.proposal);
  return [...ids];
};

const addTaskId = (ids: Set<string>, value: unknown): void => {
  if (typeof value === "string" && value.startsWith("task_")) ids.add(value);
};

const collectProposalTaskIds = (ids: Set<string>, proposal: unknown): void => {
  if (!proposal || typeof proposal !== "object") return;
  const record = proposal as Record<string, unknown>;
  if (Array.isArray(record.taskIds)) {
    for (const id of record.taskIds) addTaskId(ids, id);
  }
  addTaskId(ids, record.taskId);
  collectBatchItemTaskIds(ids, record.items);
};

const collectBatchItemTaskIds = (ids: Set<string>, items: unknown): void => {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item && typeof item === "object") {
      addTaskId(ids, (item as Record<string, unknown>).taskId);
    }
  }
};

const findOriginSessionFromChatHistory = async (
  db: Kysely<Database>,
  taskId: string,
): Promise<string | null> => {
  const row = await db
    .selectFrom("chat_messages")
    .select(["session_id"])
    .where("action", "like", `%${taskId}%`)
    .orderBy("created_at", "asc")
    .executeTakeFirst();
  return row?.session_id ?? null;
};

const titleFromChangePath = (changePath: string): string => {
  const slug = changePath.split("/").pop() ?? changePath;
  return slug
    .replace(/-[a-f0-9]{8}$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const buildStatusMessage = (title: string, status: TaskStatus): string => {
  if (status === "DONE") {
    return `Task **${title}** is done.`;
  }
  return `Task **${title}** is blocked and needs attention.`;
};
