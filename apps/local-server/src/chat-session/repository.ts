import type { Kysely } from "kysely";
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
  list: () => Promise<ChatSessionListRow[]>;
  update: (id: string, patch: ChatSessionUpdate) => Promise<ChatSession | null>;
  delete: (id: string) => Promise<boolean>;
  deleteGraph: (
    id: string,
    options?: DeleteChatSessionGraphOptions,
  ) => Promise<DeleteChatSessionGraphResult>;
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
          "chat_sessions.default_worker_id",
          "chat_sessions.default_workflow_id",
          "chat_sessions.pinned",
          "chat_sessions.settled_override",
          "chat_sessions.settled_at",
          "chat_sessions.last_read_at",
          "chat_sessions.created_at",
          "chat_sessions.updated_at",
          "repos.name as repo_name",
          "repos.path as repo_path",
        ])
        .orderBy("chat_sessions.pinned", "desc")
        .orderBy("chat_sessions.updated_at", "desc")
        .execute();

      const rows: ChatSessionListRow[] = [];
      for (const session of sessions) {
        const last = await db
          .selectFrom("chat_messages")
          .select(["content", "created_at"])
          .where("session_id", "=", session.id)
          .orderBy("created_at", "desc")
          .limit(1)
          .executeTakeFirst();
        const unreadCount = await countUnreadAssistantMessages(
          db,
          session.id,
          session.last_read_at,
        );

        rows.push({
          ...session,
          last_message_content: last?.content ?? null,
          last_message_at: last?.created_at ?? null,
          unread_count: unreadCount,
        });
      }
      return rows;
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
