import { afterEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { isProcessAlive } from "../process/liveness.ts";
import { spawnRunning } from "../process/test-utils.ts";
import {
  isChatRunProcessGone,
  recordChatRunPid,
  stopOrphanedChatRunProcess,
} from "./run-process.ts";

let db: Kysely<Database> | undefined;
const spawned: Array<{ kill: () => void }> = [];

afterEach(async () => {
  for (const proc of spawned.splice(0)) proc.kill();
  await db?.destroy();
  db = undefined;
});

/** A detached process group, like the chat engine's CLI spawn. */
const spawnSleeper = async (seconds = 30) => {
  const proc = await spawnRunning(["sleep", String(seconds)], { detached: true });
  spawned.push(proc);
  return proc;
};

const waitUntilGone = async (pid: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!isProcessAlive(pid)) return true;
    await Bun.sleep(20);
  }
  return false;
};

const seedRun = async (status: "running" | "completed") => {
  db = await createTestDb();
  await db
    .insertInto("chat_sessions")
    .values({
      id: "isess_pid",
      repo_id: null,
      title: "t",
      runtime: "claude-code",
      model: "m",
      reasoning_effort: "medium",
    })
    .execute();
  await db
    .insertInto("chat_messages")
    .values({ id: "smsg_pid", session_id: "isess_pid", role: "user", content: "hi" })
    .execute();
  await db
    .insertInto("chat_runs")
    .values({
      id: "crun_pid",
      session_id: "isess_pid",
      user_message_id: "smsg_pid",
      assistant_message_id: "smsg_pid_reply",
      runtime: "claude-code",
      log_file_path: "/tmp/crun_pid.jsonl",
      status,
    })
    .execute();
  return createCommandContext(db);
};

describe("recordChatRunPid", () => {
  test("stores the pid on a running chat run", async () => {
    const ctx = await seedRun("running");

    await recordChatRunPid(ctx, "crun_pid", 4242);

    const row = await ctx.db.selectFrom("chat_runs").select("pid").executeTakeFirstOrThrow();
    expect(row.pid).toBe(4242);
  });

  test("leaves a finished run untouched", async () => {
    const ctx = await seedRun("completed");

    await recordChatRunPid(ctx, "crun_pid", 4242);

    const row = await ctx.db.selectFrom("chat_runs").select("pid").executeTakeFirstOrThrow();
    expect(row.pid).toBeNull();
  });
});

describe("isChatRunProcessGone", () => {
  test("never declares a run without a recorded pid gone", () => {
    expect(isChatRunProcessGone({ pid: null }, null)).toBe(false);
  });

  test("declares the run gone once its pid has exited", () => {
    expect(isChatRunProcessGone({ pid: 999_999 }, "sleep")).toBe(true);
  });

  test("declares the run gone when the pid now belongs to a non-agent process", async () => {
    const proc = await spawnSleeper();
    expect(isChatRunProcessGone({ pid: proc.pid }, "/opt/fake-cli.ts")).toBe(true);
  });

  test("keeps the run live while its CLI is running", async () => {
    const proc = await spawnSleeper();
    expect(isChatRunProcessGone({ pid: proc.pid }, "sleep")).toBe(false);
  });
});

describe("stopOrphanedChatRunProcess", () => {
  test("terminates the recorded CLI process", async () => {
    const proc = await spawnSleeper();

    const stopped = await stopOrphanedChatRunProcess({ id: "crun_1", pid: proc.pid }, "sleep");

    expect(stopped).toBe(true);
    expect(await waitUntilGone(proc.pid)).toBe(true);
  });

  test("leaves a live process alone when it is not the run's CLI", async () => {
    const proc = await spawnSleeper();

    const stopped = await stopOrphanedChatRunProcess(
      { id: "crun_1", pid: proc.pid },
      "/opt/fake-cli.ts",
    );

    expect(stopped).toBe(false);
    expect(isProcessAlive(proc.pid)).toBe(true);
  });

  test("does nothing for a run without a pid or with an exited pid", async () => {
    expect(await stopOrphanedChatRunProcess({ id: "crun_1", pid: null }, "sleep")).toBe(false);
    expect(await stopOrphanedChatRunProcess({ id: "crun_1", pid: 999_999 }, "sleep")).toBe(false);
  });
});
