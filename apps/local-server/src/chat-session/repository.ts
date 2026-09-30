import { type Kysely, sql } from "kysely";
import type {
  ChatMessage,
  ChatSession,
  ChatSessionUpdate,
  Database,
  NewChatMessage,
  NewChatSession,
} from "../db/schema.ts";
import {
  type DeleteChatSessionGraphOptions,
  type DeleteChatSessionGraphResult,
  deleteChatSessionGraph,
} from "./session-graph-deletion.ts";

export interface ChatSessionListRow extends ChatSession {
  repo_name: string | null;
  repo_path: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface ChatSessionRepository {
  create: (session: NewChatSession) => Promise<ChatSession>;
  getById: (id: string) => Promise<ChatSession | null>;
  /** The chat sessions that belong to no project; a project's sessions are read through `listByProject`. */
  list: () => Promise<ChatSessionListRow[]>;
  /** A project's coordinator and threads. */
  listByProject: (projectId: string) => Promise<ChatSession[]>;
  getCoordinator: (projectId: string) => Promise<ChatSession | null>;
  update: (id: string, patch: ChatSessionUpdate) => Promise<ChatSession | null>;
  delete: (id: string) => Promise<boolean>;
  deleteGraph: (
    id: string,
    options?: DeleteChatSessionGraphOptions,
  ) => Promise<DeleteChatSessionGraphResult>;
  getLastMessage: (
    sessionId: string,
  ) => Promise<Pick<ChatMessage, "content" | "created_at"> | null>;
  listMessages: (sessionId: string) => Promise<ChatMessage[]>;
  countMessages: (sessionId: string) => Promise<number>;
  countUnreadAssistantMessages: (sessionId: string, lastReadAt: string | null) => Promise<number>;
  createMessage: (message: NewChatMessage) => Promise<ChatMessage>;
}

export const createChatSessionRepository = (db: Kysely<Database>): ChatSessionRepository => {
  return {
    create: async (session: NewChatSession): Promise<ChatSession> => {
      await db.insertInto("chat_sessions").values(session).execute();
      return db
        .selectFrom("chat_sessions")
        .selectAll()
        .where("id", "=", session.id)
        .executeTakeFirstOrThrow();
    },

    getById: async (id: string): Promise<ChatSession | null> => {
      const session = await db
        .selectFrom("chat_sessions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return session ?? null;
    },

    list: async (): Promise<ChatSessionListRow[]> => {
      const sessions = await db
        .selectFrom("chat_sessions")
        .leftJoin("repos", "repos.id", "chat_sessions.repo_id")
        .select([
          "chat_sessions.id",
          "chat_sessions.repo_id",
          "chat_sessions.title",
          "chat_sessions.named",
          "chat_sessions.runtime",
          "chat_sessions.runtime_configuration_id",
          "chat_sessions.model",
          "chat_sessions.reasoning_effort",
          "chat_sessions.runtime_alias",
          "chat_sessions.runtime_session_id",
          "chat_sessions.workspace_path",
          "chat_sessions.fast_mode",
          "chat_sessions.runtime_access_mode",
          "chat_sessions.pinned",
          "chat_sessions.settled_override",
          "chat_sessions.settled_at",
          "chat_sessions.last_read_at",
          "chat_sessions.created_at",
          "chat_sessions.updated_at",
          "chat_sessions.project_id",
          "chat_sessions.kind",
          "chat_sessions.state",
          "chat_sessions.blocked_question_json",
          "chat_sessions.steps_json",
          "chat_sessions.status_line",
          "chat_sessions.branch",
          "chat_sessions.pr_number",
          "chat_sessions.pr_url",
          "chat_sessions.pr_state",
          "chat_sessions.pr_checks_json",
          "chat_sessions.target_json",
          "chat_sessions.last_activity_at",
          "chat_sessions.unread",
          "chat_sessions.resolved_at",
          "chat_sessions.resumes_at",
          "repos.name as repo_name",
          "repos.path as repo_path",
          sql<string | null>`(
            SELECT last_message.content
            FROM chat_messages AS last_message
            WHERE last_message.session_id = chat_sessions.id
            ORDER BY last_message.created_at DESC, last_message.id DESC
            LIMIT 1
          )`.as("last_message_content"),
          sql<string | null>`(
            SELECT last_message.created_at
            FROM chat_messages AS last_message
            WHERE last_message.session_id = chat_sessions.id
            ORDER BY last_message.created_at DESC, last_message.id DESC
            LIMIT 1
          )`.as("last_message_at"),
          sql<number>`(
            SELECT COUNT(*)
            FROM chat_messages AS unread_message
            WHERE unread_message.session_id = chat_sessions.id
              AND unread_message.role = 'assistant'
              AND unread_message.created_at > COALESCE(chat_sessions.last_read_at, '')
          )`.as("unread_count"),
        ])
        .where("chat_sessions.project_id", "is", null)
        .orderBy("chat_sessions.pinned", "desc")
        .orderBy("chat_sessions.updated_at", "desc")
        .execute();
      return sessions.map((session) => ({
        ...session,
        unread_count: Number(session.unread_count),
      }));
    },

    listByProject: (projectId) =>
      db
        .selectFrom("chat_sessions")
        .selectAll()
        .where("project_id", "=", projectId)
        .orderBy("created_at")
        .orderBy("id")
        .execute(),

    getCoordinator: async (projectId) => {
      const session = await db
        .selectFrom("chat_sessions")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("kind", "=", "coordinator")
        .executeTakeFirst();
      return session ?? null;
    },

    update: async (id: string, patch: ChatSessionUpdate): Promise<ChatSession | null> => {
      await db.updateTable("chat_sessions").set(patch).where("id", "=", id).execute();
      return db
        .selectFrom("chat_sessions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst()
        .then((row) => row ?? null);
    },

    delete: async (id) => (await deleteChatSessionGraph(db, id)).deleted,

    deleteGraph: (id, options) => deleteChatSessionGraph(db, id, options),

    getLastMessage: async (sessionId) => {
      const message = await db
        .selectFrom("chat_messages")
        .select(["content", "created_at"])
        .where("session_id", "=", sessionId)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst();
      return message ?? null;
    },

    listMessages: async (sessionId: string): Promise<ChatMessage[]> => {
      return db
        .selectFrom("chat_messages")
        .selectAll()
        .where("session_id", "=", sessionId)
        .orderBy("turn_index")
        .orderBy("created_at")
        .orderBy("id")
        .execute();
    },

    countMessages: async (sessionId: string): Promise<number> => {
      const row = await db
        .selectFrom("chat_messages")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("session_id", "=", sessionId)
        .executeTakeFirst();
      return Number(row?.count ?? 0);
    },

    countUnreadAssistantMessages: (sessionId, lastReadAt) =>
      countUnreadAssistantMessages(db, sessionId, lastReadAt),

    createMessage: async (message: NewChatMessage): Promise<ChatMessage> => {
      await db.insertInto("chat_messages").values(message).execute();
      return db
        .selectFrom("chat_messages")
        .selectAll()
        .where("id", "=", message.id)
        .executeTakeFirstOrThrow();
    },
  };
};

const countUnreadAssistantMessages = async (
  db: Kysely<Database>,
  sessionId: string,
  lastReadAt: string | null,
): Promise<number> => {
  const unread = await db
    .selectFrom("chat_messages")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("session_id", "=", sessionId)
    .where("role", "=", "assistant")
    .where("created_at", ">", lastReadAt ?? "")
    .executeTakeFirst();
  return Number(unread?.count ?? 0);
};
