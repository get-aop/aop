import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { aopPaths } from "@aop/infra";
import { ClaudeCodeProvider, type LLMProvider } from "@aop/llm-provider";
import { FAKE_CLI_PATH } from "@aop/llm-provider/test-fixtures";
import { Hono } from "hono";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { isAgentProcess, isProcessAlive } from "../process/liveness.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { createChatSessionRoutes } from "./routes.ts";
import { waitForPendingChatReplies } from "./service.ts";
import { type ChatSessionEvent, subscribeChatSession } from "./session-events.ts";

// Drives the chat engine with the real ClaudeCodeProvider against the fake CLI. The seam is
// a runtime configuration whose `command` is the fake's path: choosing it copies the command
// into the session's `runtime_alias`, and the engine passes that to the adapter as
// `runtimeAlias`. A session that is not bound to a runtime configuration has its alias
// re-resolved to the plain `claude` on every send, so setting the column alone does not work.

interface MessageRow {
  role: string;
  content: string;
  runStatus?: string;
  interruptionKind?: string | null;
}

interface SessionBody {
  runtimeSessionId: string | null;
  assistantActive: boolean;
  messages: MessageRow[];
}

// The one guard between this suite and a real model call: run the real adapter, but only when
// it is about to spawn the fake. Anything else fails the turn instead of reaching `claude`.
const fakeOnlyClaude: LLMProvider = {
  name: "claude-code",
  run: (options) => {
    const provider = new ClaudeCodeProvider();
    const [executable] = provider.buildCommand(options);
    if (executable !== FAKE_CLI_PATH) {
      throw new Error(`Refusing to spawn ${executable}; this suite only runs the fake CLI`);
    }
    return provider.run(options);
  },
};

let aopHome: string;
let previousAopHome: string | undefined;

beforeAll(() => {
  // Chat logs and the fake's session store both live under AOP_HOME.
  previousAopHome = process.env.AOP_HOME;
  aopHome = mkdtempSync(join(tmpdir(), "aop-chat-fake-cli-"));
  process.env.AOP_HOME = aopHome;
});

afterAll(() => {
  if (previousAopHome === undefined) delete process.env.AOP_HOME;
  else process.env.AOP_HOME = previousAopHome;
  rmSync(aopHome, { recursive: true, force: true });
});

const setup = async () => {
  const db = await createTestDb();
  const repoPath = join(aopHome, `repo-${crypto.randomUUID()}`);
  mkdirSync(repoPath, { recursive: true });
  await createTestRepo(db, "repo_fake_cli", repoPath);
  const app = new Hono();
  app.route(
    "/api/chat-sessions",
    createChatSessionRoutes(createCommandContext(db), { createProviderFn: () => fakeOnlyClaude }),
  );

  const configurations = createRuntimeConfigurationRepository(db);
  const provider = await configurations.createProvider({
    name: "Fake CLI",
    command: FAKE_CLI_PATH,
    driver: "claude-code",
  });
  await configurations.createModel(provider.id, {
    description: "Fake model",
    model: "fake-model",
    thinkingLevels: [],
  });
  const created = await app.request("/api/chat-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId: "repo_fake_cli" }),
  });
  const { session } = (await created.json()) as { session: { id: string } };
  const bound = await app.request(`/api/chat-sessions/${session.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runtimeConfigurationId: provider.id }),
  });
  expect(bound.status).toBe(200);

  const events: ChatSessionEvent[] = [];
  subscribeChatSession(session.id, (event) => events.push(event));

  const detail = async (): Promise<SessionBody> => {
    const response = await app.request(`/api/chat-sessions/${session.id}`);
    return ((await response.json()) as { session: SessionBody }).session;
  };
  const send = async (content: string): Promise<void> => {
    const response = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    expect(response.status).toBe(201);
  };
  const sendAndSettle = async (content: string): Promise<SessionBody> => {
    await send(content);
    await waitForPendingChatReplies();
    return detail();
  };
  const abort = async (): Promise<Response> =>
    app.request(`/api/chat-sessions/${session.id}/abort`, { method: "POST" });

  return { db, app, session, events, detail, send, sendAndSettle, abort };
};

/** Polls until `predicate` holds; the fake and the reaper settle within a few seconds. */
const eventually = async (predicate: () => boolean | Promise<boolean>): Promise<boolean> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return true;
    await Bun.sleep(25);
  }
  return false;
};

/**
 * What a server that died mid-turn leaves behind: a running chat_runs row with the
 * CLI's pid and log, and no in-memory run handle in the server that reads it.
 */
const insertOrphanedRun = async (
  db: Awaited<ReturnType<typeof setup>>["db"],
  sessionId: string,
  run: { id: string; pid: number; logFilePath: string },
): Promise<void> => {
  await db
    .insertInto("chat_messages")
    .values({ id: `${run.id}_user`, session_id: sessionId, role: "user", content: "long job" })
    .execute();
  await db
    .insertInto("chat_runs")
    .values({
      id: run.id,
      session_id: sessionId,
      user_message_id: `${run.id}_user`,
      assistant_message_id: `${run.id}_reply`,
      runtime: "claude-code",
      log_file_path: run.logFilePath,
      status: "running",
      pid: run.pid,
    })
    .execute();
};

/** Starts the fake the way the adapter does (detached, stdout to the run log), outside the engine. */
const spawnDetachedFake = (prompt: string, logFilePath: string) => {
  mkdirSync(dirname(logFilePath), { recursive: true });
  const argv = new ClaudeCodeProvider().buildCommand({
    prompt,
    runtimeAlias: FAKE_CLI_PATH,
    logFilePath,
  });
  return Bun.spawn(argv, {
    stdout: Bun.file(logFilePath),
    stderr: "ignore",
    stdin: "ignore",
    detached: true,
  });
};

const runRow = (db: Awaited<ReturnType<typeof setup>>["db"], runId: string) =>
  db.selectFrom("chat_runs").selectAll().where("id", "=", runId).executeTakeFirstOrThrow();

const lastAssistant = (body: SessionBody): MessageRow | undefined =>
  body.messages.filter((message) => message.role === "assistant").at(-1);

/** The fake writes its init event first; once it is in the log the process is live. */
const waitForFakeInit = async (sessionId: string): Promise<void> => {
  const dir = join(aopPaths.logs(), "chat-sessions", sessionId);
  for (let attempt = 0; attempt < 200; attempt++) {
    const logs = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    if (logs.some((name) => readFileSync(join(dir, name), "utf8").includes('"subtype":"init"'))) {
      return;
    }
    await Bun.sleep(25);
  }
  throw new Error("fake CLI never wrote its init event");
};

describe("chat engine against the fake CLI", () => {
  test("streams progress while the CLI works, then finalizes the reply and binds the session", async () => {
    const { db, events, sendAndSettle } = await setup();

    const body = await sendAndSettle("build it [fake: steps=2 delay=300]");

    const reply = lastAssistant(body);
    expect(body.runtimeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reply?.content).toBe(
      `Fake reply for turn 1 of session ${body.runtimeSessionId}. You said: build it`,
    );
    const types = events.map((event) => event.type);
    expect(types.indexOf("assistant-progress")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("assistant-progress")).toBeLessThan(types.indexOf("assistant-final"));
    const streamed = events.flatMap((event) =>
      event.type === "assistant-progress" ? [event.content] : [],
    );
    expect(streamed.join("")).toContain("Working on step 1 of 2.");
    await db.destroy();
  });

  test("resumes the bound runtime session on the next message", async () => {
    const { db, sendAndSettle } = await setup();

    const first = await sendAndSettle("first");
    const second = await sendAndSettle("second");

    expect(second.runtimeSessionId).toBe(first.runtimeSessionId);
    expect(lastAssistant(second)?.content).toBe(
      `Fake reply for turn 2 of session ${first.runtimeSessionId} (resumed). You said: second`,
    );
    await db.destroy();
  });

  test("Stop kills the running CLI and the next message resumes the same session", async () => {
    const { db, session, send, abort, detail, sendAndSettle } = await setup();

    await send("long job [fake: steps=3 delay=30000]");
    await waitForFakeInit(session.id);
    const aborted = await abort();
    await waitForPendingChatReplies();

    expect(aborted.status).toBe(200);
    const stopped = await detail();
    expect(stopped.assistantActive).toBe(false);
    expect(stopped.messages[0]).toMatchObject({
      runStatus: "cancelled",
      interruptionKind: "abort",
    });
    const resumed = await sendAndSettle("carry on");
    expect(resumed.runtimeSessionId).toBe(stopped.runtimeSessionId);
    expect(lastAssistant(resumed)?.content).toContain("turn 2");
    expect(lastAssistant(resumed)?.content).toContain("(resumed)");
    await db.destroy();
  });

  test("a CLI that crashes mid-turn fails the run, and the session still resumes", async () => {
    const { db, sendAndSettle } = await setup();

    const crashed = await sendAndSettle("break [fake: steps=2 crash=3]");

    expect(crashed.messages[0]?.runStatus).toBe("failed");
    expect(lastAssistant(crashed)?.content).toContain("Runtime exited with code");
    expect(crashed.runtimeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    const recovered = await sendAndSettle("try again");
    expect(lastAssistant(recovered)?.content).toContain("(resumed). You said: try again");
    await db.destroy();
  });

  test("records the CLI's pid on the running chat run", async () => {
    const { db, session, send, abort } = await setup();

    await send("long job [fake: delay=30000]");
    await waitForFakeInit(session.id);
    const running = await db
      .selectFrom("chat_runs")
      .select(["id", "pid"])
      .where("session_id", "=", session.id)
      .executeTakeFirstOrThrow();

    expect(running.pid).toBeGreaterThan(0);
    const pid = running.pid ?? 0;
    expect(isProcessAlive(pid)).toBe(true);
    expect(isAgentProcess(pid, { executable: FAKE_CLI_PATH })).toBe(true);

    await abort();
    await waitForPendingChatReplies();
    expect(await eventually(() => !isProcessAlive(pid))).toBe(true);
    await db.destroy();
  });

  test("Stop after a server restart kills the orphaned CLI and cancels its run", async () => {
    const { db, session, abort } = await setup();
    const logFilePath = join(aopPaths.logs(), "chat-sessions", session.id, "orphan.jsonl");
    const orphan = spawnDetachedFake("long job [fake: delay=30000]", logFilePath);
    await insertOrphanedRun(db, session.id, { id: "crun_orphan", pid: orphan.pid, logFilePath });
    await waitForFakeInit(session.id);

    const response = await abort();

    expect(await response.json()).toMatchObject({ disposition: "durable_cancelled" });
    expect(await eventually(() => !isProcessAlive(orphan.pid))).toBe(true);
    expect(await runRow(db, "crun_orphan")).toMatchObject({
      status: "cancelled",
      interruption_kind: "abort",
    });
    await db.destroy();
  });

  test("a restarted server fails a run whose CLI died mid-turn instead of waiting forever", async () => {
    const { db, session } = await setup();
    const logFilePath = join(aopPaths.logs(), "chat-sessions", session.id, "crashed.jsonl");
    const crashed = spawnDetachedFake("break [fake: steps=2 delay=50 crash=3]", logFilePath);
    await crashed.exited;
    await insertOrphanedRun(db, session.id, { id: "crun_crashed", pid: crashed.pid, logFilePath });

    // A new service over the same database is what a restarted server builds.
    createChatSessionRoutes(createCommandContext(db), {
      createProviderFn: () => fakeOnlyClaude,
      recoveryPollIntervalMs: 20,
    });
    expect(
      await eventually(async () => (await runRow(db, "crun_crashed")).status !== "running"),
    ).toBe(true);

    const run = await runRow(db, "crun_crashed");
    expect(run.status).toBe("failed");
    expect(run.error_message).toContain("exited without a final response");
    await waitForPendingChatReplies();
    await db.destroy();
  });
});
