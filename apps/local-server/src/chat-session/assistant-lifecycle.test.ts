import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely, KyselyPlugin } from "kysely";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { resolveAssistantLifecycles } from "./service.ts";
import { seedChatSessionGraph } from "./test-utils.ts";

describe("resolveAssistantLifecycles", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("loads durable state for every session in one query", async () => {
    await seedChatSessionGraph(db, { sessionId: "isess_idle" });
    const running = await seedChatSessionGraph(db, { sessionId: "isess_running" });
    await db
      .updateTable("chat_runs")
      .set({ status: "running" })
      .where("id", "=", running.runIds[0] as string)
      .execute();
    let queryCount = 0;
    const counter: KyselyPlugin = {
      transformQuery: ({ node }) => {
        queryCount += 1;
        return node;
      },
      transformResult: async ({ result }) => result,
    };
    const ctx = createCommandContext(db.withPlugin(counter));

    const lifecycles = await resolveAssistantLifecycles(ctx, ["isess_idle", "isess_running"]);

    expect(queryCount).toBe(1);
    expect(Object.fromEntries(lifecycles)).toEqual({
      isess_idle: "idle",
      isess_running: "uncontrollable",
    });
  });
});
