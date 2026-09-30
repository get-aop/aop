import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChatDelegationRun } from "@aop/common";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import {
  deleteDelegationRunsByChatRunIds,
  listDelegationRuns,
  listDelegationRunsByChatRunIds,
  replaceDelegationRuns,
} from "./delegation-run-store.ts";
import { seedBareChatRuns } from "./test-utils.ts";

const entry = (id: string, overrides: Partial<ChatDelegationRun> = {}): ChatDelegationRun => ({
  id,
  kind: "delegation",
  label: "Codex",
  runtime: "codex-cli",
  runtimeAlias: null,
  runtimeConfigurationId: null,
  model: "gpt-5.5",
  reasoning: "high",
  fastMode: false,
  status: "active",
  activity: null,
  runtimeSessionId: null,
  logFilePath: "/tmp/x.jsonl",
  error: null,
  startedAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:00:00.000Z",
  ...overrides,
});

describe("delegation-run-store", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
    await seedBareChatRuns(db, ["crun_1", "crun_2"]);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("replaceAll round-trips entries as rows", async () => {
    await replaceDelegationRuns(db, "crun_1", [
      entry("del_1"),
      entry("del_2", { kind: "background-task", toolUseId: "tool-2" }),
    ]);

    const entries = await listDelegationRuns(db, "crun_1");
    expect(entries.map((e) => e.id).sort()).toEqual(["del_1", "del_2"]);
    expect(entries[1]).toMatchObject({ kind: "background-task", toolUseId: "tool-2" });
  });

  test("replaceAll overwrites the previous rows of the host run", async () => {
    await replaceDelegationRuns(db, "crun_1", [entry("del_1"), entry("del_2")]);
    await replaceDelegationRuns(db, "crun_1", [entry("del_1", { status: "failed" })]);

    const entries = await listDelegationRuns(db, "crun_1");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("failed");
  });

  test("lists by chat run ids and deletes by chat run ids", async () => {
    await replaceDelegationRuns(db, "crun_1", [entry("del_1")]);
    await replaceDelegationRuns(db, "crun_2", [entry("del_2")]);

    const byRun = await listDelegationRunsByChatRunIds(db, ["crun_1", "crun_2"]);
    expect(byRun.get("crun_1")?.map((e) => e.id)).toEqual(["del_1"]);
    expect(byRun.get("crun_2")?.map((e) => e.id)).toEqual(["del_2"]);

    await deleteDelegationRunsByChatRunIds(db, ["crun_1"]);
    expect(await listDelegationRuns(db, "crun_1")).toHaveLength(0);
    expect(await listDelegationRuns(db, "crun_2")).toHaveLength(1);
  });
});
