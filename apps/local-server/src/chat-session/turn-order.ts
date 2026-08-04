import type { Kysely, Transaction } from "kysely";
import type { Database } from "../db/schema.ts";

export const nextChatTurnIndex = async (
  db: Kysely<Database> | Transaction<Database>,
  sessionId: string,
): Promise<number> => {
  const latest = await db
    .selectFrom("chat_messages")
    .select("turn_index")
    .where("session_id", "=", sessionId)
    .orderBy("turn_index", "desc")
    .limit(1)
    .executeTakeFirst();
  return (latest?.turn_index ?? 0) + 1;
};
