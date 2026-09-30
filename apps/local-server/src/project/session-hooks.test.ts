import { afterEach, describe, expect, test } from "bun:test";
import type { MessageDelta } from "@aop/common";
import { Hono } from "hono";
import { serializeMessageOrigin } from "../chat-session/message-origin.ts";
import { createChatSessionRoutes } from "../chat-session/routes.ts";
import type { ChatSession } from "../db/schema.ts";
import { createProjectServices } from "./services.ts";
import { createProjectSessionHooks } from "./session-hooks.ts";
import {
  createProjectStack,
  eventually,
  fakeOnlyClaude,
  insertProjectRow,
  insertProjectSession,
  type ProjectStack,
  projectSettings,
  useTempAopHome,
} from "./test-utils.ts";

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path());
  stack = s;
  const created = await s.services.projects.create(
    projectSettings({ repoIds: s.repos.map((repo) => repo.id) }),
  );
  if (!created.success) throw new Error("project not created");
  const coordinator = (await s.ctx.chatSessionRepository.getCoordinator(
    created.project.id,
  )) as ChatSession;
  return { s, project: created.project, coordinator };
};

// The status of each call a client makes on a session id: read, stop, send, delete.
const statusesOf = async (chat: Hono, sessionId: string): Promise<number[]> => {
  const calls = [
    ["GET", `/api/chat-sessions/${sessionId}`],
    ["POST", `/api/chat-sessions/${sessionId}/abort`],
    ["POST", `/api/chat-sessions/${sessionId}/messages`],
    ["DELETE", `/api/chat-sessions/${sessionId}`],
  ] as const;
  return Promise.all(
    calls.map(async ([method, path]) => {
      const response = await chat.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ content: "x" }) : undefined,
      });
      return response.status;
    }),
  );
};

describe("the coordinator's inbox is durable", () => {
  test("a report still waiting when the server stopped is answered when the next server starts", async () => {
    const { s, project, coordinator } = await setup();
    // What a crash between a thread finishing and the coordinator starting leaves behind.
    await s.db
      .insertInto("chat_messages")
      .values({
        id: "smsg_waiting_report",
        session_id: coordinator.id,
        role: "user",
        content: 'Thread report: "Audit" (isess_x) finished a turn and is now idle.',
        turn_index: 1,
        disposition: "queued",
        created_at: new Date().toISOString(),
        origin_json: serializeMessageOrigin({
          type: "thread-report",
          threadId: "isess_x",
          outcome: "finished",
        }),
      })
      .execute();
    expect(await s.ctx.chatSessionRepository.countMessages(coordinator.id)).toBe(1);

    // A new engine over the same database is what a restarted server builds.
    createProjectServices(s.ctx, { createProviderFn: () => fakeOnlyClaude });

    await eventually(async () => {
      const messages = await s.services.projects.listMessages(project.id);
      return messages.success && messages.messages.some((message) => message.role === "assistant")
        ? true
        : undefined;
    }, "the coordinator to answer the waiting report");
    await s.settle();
    const runs = await s.db.selectFrom("chat_runs").select("status").execute();
    expect(runs.map((run) => run.status)).toEqual(["completed"]);
  });

  test("a project that is not active is not woken by what was left queued", async () => {
    const { s, project, coordinator } = await setup();
    await s.services.projects.transition(project.id, "pause");
    await s.db
      .insertInto("chat_messages")
      .values({
        id: "smsg_queued",
        session_id: coordinator.id,
        role: "user",
        content: "Thread report: late",
        turn_index: 1,
        disposition: "queued",
        created_at: new Date().toISOString(),
      })
      .execute();

    // Only unclaimed messages are drained: this one has a cancelled run, as a pause leaves them.
    await s.db
      .insertInto("chat_runs")
      .values({
        id: "crun_cancelled",
        session_id: coordinator.id,
        user_message_id: "smsg_queued",
        assistant_message_id: "smsg_never",
        runtime: "claude-code",
        log_file_path: "/tmp/x.jsonl",
        status: "cancelled",
      })
      .execute();
    createProjectServices(s.ctx, { createProviderFn: () => fakeOnlyClaude });
    await Bun.sleep(100);
    await s.settle();

    expect(s.runs).toEqual([]);
  });
});

describe("clients hear of project changes through the event publisher", () => {
  const listen = (s: ProjectStack, projectId: string) => {
    const deltas: MessageDelta[] = [];
    let commits = 0;
    const subscription = s.ctx.eventPublisher.subscribe(projectId, {
      onCommit: () => {
        commits += 1;
      },
      onDelta: (delta) => deltas.push(delta),
    });
    return { deltas, commits: () => commits, stop: subscription.unsubscribe };
  };

  test("a reply is streamed live under the id the finished message gets, and every commit is announced", async () => {
    const { s, project } = await setup();
    const heard = listen(s, project.id);

    await s.services.projects.sendToCoordinator(project.id, "build it [fake: steps=2 delay=200]");
    await s.settle();
    heard.stop();

    const listed = await s.services.projects.listMessages(project.id);
    const reply = listed.success
      ? listed.messages.find((message) => message.role === "assistant")
      : undefined;
    expect(heard.deltas.length).toBeGreaterThan(0);
    for (const delta of heard.deltas) {
      expect(delta).toMatchObject({ projectId: project.id, threadId: null, messageId: reply?.id });
    }
    const live = heard.deltas.reduce(
      (text, delta) => (delta.replace ? delta.text : text + delta.text),
      "",
    );
    expect(live).toContain("Working on step 1 of 2.");
    // The user's message and the finished reply were each committed with their log entries.
    expect(heard.commits()).toBeGreaterThanOrEqual(2);
  });

  test("a thread's live text carries the thread id, and its changes are announced", async () => {
    const { s, project } = await setup();
    const heard = listen(s, project.id);

    const spawned = await s.services.threads.spawn(project.id, {
      title: "Work",
      prompt: "Do it [fake: steps=1 delay=200]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();
    heard.stop();

    expect(heard.deltas.some((delta) => delta.threadId === spawned.thread.id)).toBe(true);
    expect(heard.commits()).toBeGreaterThanOrEqual(3);
  });
});

describe("a project hook that fails", () => {
  test("does not leave the run unfinished, and Stop repairs the thread's stale status", async () => {
    const { s, project } = await setup();
    const working = s.ctx.sessionHooks;
    s.ctx.sessionHooks = {
      ...working,
      onRunFinalized: async () => {
        throw new Error("hook bug");
      },
    };

    const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt: "Do it" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const runs = await s.db.selectFrom("chat_runs").select("status").execute();
    const messages = await s.ctx.chatSessionRepository.listMessages(spawned.thread.id);
    expect(runs.map((run) => run.status)).toEqual(["completed"]);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    const stale = await s.services.threads.get(spawned.thread.id);
    expect(stale.success && stale.thread.status).toBe("working");

    const stopped = await s.services.threads.stop(spawned.thread.id);
    expect(stopped.success && stopped.thread).toMatchObject({
      status: "idle",
      liveStatusLine: "Stopped",
    });
  });
});

describe("a turn that ends with nothing to show", () => {
  test("clears its live text, since no message.created entry will replace it", async () => {
    const s = await createProjectStack(home.path());
    stack = s;
    await insertProjectRow(s.db, "proj_1");
    await insertProjectSession(s.db, {
      id: "isess_coord",
      projectId: "proj_1",
      kind: "coordinator",
    });
    await s.db
      .insertInto("chat_messages")
      .values([
        {
          id: "u1",
          session_id: "isess_coord",
          role: "user",
          content: "hi",
          created_at: "2026-09-30T10:00:00.000Z",
        },
        {
          id: "a1",
          session_id: "isess_coord",
          role: "assistant",
          content: "  ",
          created_at: "2026-09-30T10:00:01.000Z",
        },
      ])
      .execute();
    await s.db
      .insertInto("chat_runs")
      .values({
        id: "crun_1",
        session_id: "isess_coord",
        user_message_id: "u1",
        assistant_message_id: "a1",
        runtime: "claude-code",
        log_file_path: "/tmp/x.jsonl",
        status: "completed",
      })
      .execute();
    const run = await s.db.selectFrom("chat_runs").selectAll().executeTakeFirstOrThrow();
    const assistantMessage = await s.db
      .selectFrom("chat_messages")
      .selectAll()
      .where("id", "=", "a1")
      .executeTakeFirstOrThrow();
    const cleared: unknown[][] = [];
    const publisher = {
      ...s.ctx.eventPublisher,
      clearLive: (...args: unknown[]) => cleared.push(args),
    };

    await createProjectSessionHooks(publisher).onRunFinalized(
      { db: s.db, append: s.ctx.eventPublisher.publish },
      { run, outcome: { status: "completed", errorMessage: null }, assistantMessage },
    );

    expect(cleared).toEqual([["proj_1", null, "a1"]]);
    expect(await s.db.selectFrom("event_log").select("id").execute()).toEqual([]);
  });
});

describe("chat sessions that belong to no project", () => {
  test("are untouched by the project hooks: no event log entries, and they still chat", async () => {
    const s = await createProjectStack(home.path());
    stack = s;
    const chat = new Hono().route(
      "/api/chat-sessions",
      createChatSessionRoutes(s.ctx, { createProviderFn: () => fakeOnlyClaude }),
    );
    const created = await chat.request("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: s.repos[0]?.id }),
    });
    const { session } = (await created.json()) as { session: { id: string } };

    const sent = await chat.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello there" }),
    });
    await s.settle();

    expect(sent.status).toBe(201);
    expect(await s.db.selectFrom("event_log").select("id").execute()).toEqual([]);
    const messages = await s.ctx.chatSessionRepository.listMessages(session.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toContain("hello there");
  });

  test("the chat API serves them and hides a project's coordinator and threads", async () => {
    const { s, project, coordinator } = await setup();
    const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt: "Do it" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();
    const chat = new Hono().route(
      "/api/chat-sessions",
      createChatSessionRoutes(s.ctx, { createProviderFn: () => fakeOnlyClaude }),
    );
    const created = await chat.request("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: s.repos[0]?.id }),
    });
    const { session: plain } = (await created.json()) as { session: { id: string } };

    const listed = await chat.request("/api/chat-sessions");
    const ids = ((await listed.json()) as { sessions: { id: string }[] }).sessions.map(
      (item) => item.id,
    );

    expect(ids).toEqual([plain.id]);
    for (const hidden of [coordinator.id, spawned.thread.id]) {
      expect(await statusesOf(chat, hidden)).toEqual([404, 404, 404, 404]);
    }
    expect(await s.ctx.chatSessionRepository.getById(spawned.thread.id)).not.toBeNull();
  });
});
