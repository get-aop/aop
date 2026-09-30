import { type MessageBlock, MessageBlockSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../db/schema.ts";

const BlocksSchema = z.array(MessageBlockSchema);

/**
 * Message blocks a coordinator's tools attach to the reply it is writing: a card for a thread
 * it started, a receipt for messages it routed, proposals. The blocks live on the running
 * chat run until its assistant message exists, and the message is [its text, ...these].
 */
export interface RunBlocks {
  /** Adds a block to the run executing in the session; false when nothing is running. */
  append: (sessionId: string, block: MessageBlock) => Promise<boolean>;
  /** Counts one more thread the run routed a message to ("Sent to 3 threads"). */
  countRouted: (sessionId: string) => Promise<boolean>;
}

export const createRunBlocks = (db: Kysely<Database>): RunBlocks => {
  const change = (sessionId: string, edit: (blocks: MessageBlock[]) => MessageBlock[]) =>
    db.transaction().execute(async (trx) => {
      const run = await trx
        .selectFrom("chat_runs")
        .select(["id", "blocks_json"])
        .where("session_id", "=", sessionId)
        .where("status", "=", "running")
        .executeTakeFirst();
      if (!run) return false;
      const blocks = edit(BlocksSchema.parse(JSON.parse(run.blocks_json)));
      await trx
        .updateTable("chat_runs")
        .set({ blocks_json: JSON.stringify(BlocksSchema.parse(blocks)) })
        .where("id", "=", run.id)
        .execute();
      return true;
    });

  return {
    append: (sessionId, block) => change(sessionId, (blocks) => [...blocks, block]),

    countRouted: (sessionId) =>
      change(sessionId, (blocks) => {
        const receipt = blocks.find((block) => block.type === "routing-receipt");
        return receipt
          ? blocks.map((block) =>
              block === receipt ? { ...receipt, count: receipt.count + 1 } : block,
            )
          : [...blocks, { type: "routing-receipt", count: 1 }];
      }),
  };
};
