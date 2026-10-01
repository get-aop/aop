import { afterEach, describe, expect, test } from "bun:test";
import { closeSync, constants, mkdtempSync, openSync, readSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateTypeId, typeIdToUuid } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { ChatMessage, ChatRun, Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { finalizeChatRunAndPublish } from "./finalize-publish.ts";
import { deliverToRunningTurn, settleRunInput } from "./run-input.ts";
import { loadOldestQueuedMessage } from "./steer-queue.ts";

const databases: Kysely<Database>[] = [];
const processes: Bun.Subprocess[] = [];

afterEach(async () => {
  for (const proc of processes.splice(0)) proc.kill("SIGKILL");
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

const SESSION = "isess_run_input";

const line = (event: Record<string, unknown>): string => `${JSON.stringify(event)}\n`;
const replay = (messageId: string) =>
  line({ type: "user", isReplay: true, uuid: typeIdToUuid(messageId), message: { content: [] } });
const RESULT = line({ type: "result", subtype: "success", result: "Done." });

/** A session with one running Claude Code run that takes messages, and its log as `log` says. */
const setup = async (log: string, run: Partial<ChatRun> = {}) => {
  const db = await createTestDb();
  databases.push(db);
  const ctx = createCommandContext(db);
  const dir = mkdtempSync(join(tmpdir(), "aop-run-input-"));
  const logFilePath = join(dir, "run.jsonl");
  writeFileSync(logFilePath, log);
  const now = new Date().toISOString();
  await db
    .insertInto("chat_sessions")
    .values({
      id: SESSION,
      title: "Chat",
      runtime: "claude-code",
      created_at: now,
      updated_at: now,
    })
    .execute();
  const prompt = await insertMessage(db, "Build it", null);
  const row: ChatRun = {
    id: generateTypeId("crun"),
    session_id: SESSION,
    user_message_id: prompt.id,
    assistant_message_id: generateTypeId("smsg"),
    runtime: "claude-code",
    log_file_path: logFilePath,
    status: "running",
    runtime_session_id: null,
    resume_session_id: null,
    failure_kind: null,
    interruption_kind: null,
    context_strategy: "fresh",
    workspace_path: dir,
    timeout_policy: null,
    retry_of_run_id: null,
    runtime_session_state: null,
    error_message: null,
    pid: null,
    blocks_json: "[]",
    cli_version: null,
    input_path: `${logFilePath}.in`,
    created_at: now,
    updated_at: now,
    ...run,
  };
  await db.insertInto("chat_runs").values(row).execute();
  return { db, ctx, run: row, dir };
};

const insertMessage = async (
  db: Kysely<Database>,
  content: string,
  steeredRunId: string | null,
): Promise<ChatMessage> =>
  db
    .insertInto("chat_messages")
    .values({
      id: generateTypeId("smsg"),
      session_id: SESSION,
      role: "user",
      content,
      turn_index: 1,
      disposition: steeredRunId ? "steered" : "queued",
      steered_run_id: steeredRunId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

const messageRow = (db: Kysely<Database>, id: string) =>
  db
    .selectFrom("chat_messages")
    .select(["steered_run_id", "disposition"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

const finalize = (ctx: LocalServerContext, run: ChatRun, status: "completed" | "cancelled") =>
  finalizeChatRunAndPublish(ctx, run, "Done.", null, null, { status, errorMessage: null }, []);

/** Stands in for the relay: exits 9 when it is told the input ended. */
const fakeRelay = (): Bun.Subprocess => {
  const proc = Bun.spawn(["sh", "-c", "trap 'exit 9' USR1; while :; do sleep 0.05; done"]);
  processes.push(proc);
  return proc;
};

describe("a run's end and the messages sent into it", () => {
  test("one the run never took goes back in line for a turn of its own", async () => {
    const { db, ctx, run } = await setup(RESULT);
    const steer = await insertMessage(db, "use arm64", run.id);

    await finalize(ctx, run, "completed");

    expect(await messageRow(db, steer.id)).toEqual({ steered_run_id: null, disposition: "queued" });
    expect((await loadOldestQueuedMessage(ctx, SESSION))?.id).toBe(steer.id);
  });

  test("one the run took stays its own", async () => {
    const steerId = generateTypeId("smsg");
    const { db, ctx, run } = await setup(`${replay(steerId)}${RESULT}`);
    await db
      .insertInto("chat_messages")
      .values({ id: steerId, session_id: SESSION, role: "user", content: "use arm64" })
      .execute();
    await db
      .updateTable("chat_messages")
      .set({ steered_run_id: run.id })
      .where("id", "=", steerId)
      .execute();

    await finalize(ctx, run, "completed");

    expect(await messageRow(db, steerId)).toEqual({
      steered_run_id: run.id,
      disposition: "immediate",
    });
    expect(await loadOldestQueuedMessage(ctx, SESSION)).toBeUndefined();
  });

  test("what was sent to a stopped turn is dropped with it", async () => {
    const { db, ctx, run } = await setup("");
    const steer = await insertMessage(db, "use arm64", run.id);

    await finalize(ctx, run, "cancelled");

    expect(await messageRow(db, steer.id)).toEqual({
      steered_run_id: run.id,
      disposition: "immediate",
    });
    expect(await loadOldestQueuedMessage(ctx, SESSION)).toBeUndefined();
  });
});

describe("ending a run's input", () => {
  test("waits while a message sent to it is not taken yet, whatever results came before", async () => {
    const relay = fakeRelay();
    const { db, ctx, run } = await setup(RESULT, { pid: relay.pid });
    await insertMessage(db, "use arm64", run.id);

    expect(await settleRunInput(ctx, run.id)).toBe(false);
    expect(relay.exitCode).toBeNull();
  });

  test("ends it once the run has answered everything, and nothing is written to it after", async () => {
    const relay = fakeRelay();
    const steerId = generateTypeId("smsg");
    const { db, ctx, run } = await setup(`${replay(steerId)}${RESULT}`, { pid: relay.pid });
    await db
      .insertInto("chat_messages")
      .values({ id: steerId, session_id: SESSION, role: "user", content: "use arm64" })
      .execute();
    await db
      .updateTable("chat_messages")
      .set({ steered_run_id: run.id })
      .where("id", "=", steerId)
      .execute();

    expect(await settleRunInput(ctx, run.id)).toBe(true);
    expect(await relay.exited).toBe(9);

    const late = await insertMessage(db, "one more thing", null);
    const session = await ctx.chatSessionRepository.getById(SESSION);
    if (!session) throw new Error("no session");
    expect(await deliverToRunningTurn(ctx, session, late)).toBeNull();
    expect(await messageRow(db, late.id)).toEqual({ steered_run_id: null, disposition: "queued" });
  });
});

describe("writing a message into a running turn", () => {
  test("writes its stream-json line, with its id as uuid, and makes it the run's", async () => {
    const { db, ctx, run } = await setup("");
    const fifo = run.input_path ?? "";
    Bun.spawnSync(["mkfifo", fifo]);
    // A reader that does not block, as the relay holds one.
    const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const message = await insertMessage(db, "use arm64", null);
      const session = await ctx.chatSessionRepository.getById(SESSION);
      if (!session) throw new Error("no session");

      const delivered = await deliverToRunningTurn(ctx, session, message);

      expect(delivered?.id).toBe(run.id);
      const buffer = Buffer.alloc(64 * 1024);
      const written = JSON.parse(buffer.subarray(0, readSync(reader, buffer)).toString());
      expect(written).toMatchObject({
        type: "user",
        uuid: typeIdToUuid(message.id),
        message: { role: "user", content: [{ type: "text", text: "use arm64" }] },
      });
      expect(await messageRow(db, message.id)).toEqual({
        steered_run_id: run.id,
        disposition: "steered",
      });
    } finally {
      closeSync(reader);
    }
  });

  test("leaves a message in line when no running turn takes it", async () => {
    const { db, ctx } = await setup("", { status: "completed" });
    const message = await insertMessage(db, "use arm64", null);
    const session = await ctx.chatSessionRepository.getById(SESSION);
    if (!session) throw new Error("no session");

    expect(await deliverToRunningTurn(ctx, session, message)).toBeNull();
    expect(await messageRow(db, message.id)).toEqual({
      steered_run_id: null,
      disposition: "queued",
    });
  });
});
