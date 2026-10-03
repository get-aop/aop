import { afterEach, describe, expect, test } from "bun:test";
import type { AssistantMessage, Message, Project, Thread } from "@aop/common";
import { createProjectStack, eventually, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// Messages that reach a running turn: the person's to the coordinator and the coordinator's to a
// working thread, through the real engine, adapter, relay and FIFO, with the fake CLI as Claude.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const createProject = async (s: ProjectStack): Promise<Project> =>
  (
    await s.api<{ project: Project }>("POST", "/api/projects", {
      name: "Checkout",
      repoIds: s.repos.map((repo) => repo.id),
    })
  ).body.project;

const messagesOf = async (s: ProjectStack, path: string): Promise<Message[]> =>
  (await s.api<{ messages: Message[] }>("GET", path)).body.messages;

const runsOf = (s: ProjectStack, sessionId: string) =>
  s.db.selectFrom("chat_runs").selectAll().where("session_id", "=", sessionId).execute();

/** The session's CLI is up once its runtime session is known: it read its prompt. */
const cliStarted = (s: ProjectStack, sessionId: string) =>
  eventually(
    async () =>
      (await s.ctx.chatSessionRepository.getById(sessionId))?.runtime_session_id ?? undefined,
    "the CLI to start",
  );

const steerPartsOf = (message: Message | undefined): string[] =>
  message?.role === "assistant"
    ? message.blocks.flatMap((block) => (block.type === "steer" ? [block.messageId] : []))
    : [];

describe("a message to the coordinator while it works", () => {
  test("reaches its running turn, which answers it in the same reply", async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const project = await createProject(s);
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    if (!coordinator) throw new Error("no coordinator");
    const path = `/api/projects/${project.id}/messages`;

    await s.api("POST", path, { text: "Plan the release [fake: steps=3 delay=200]" });
    await cliStarted(s, coordinator.id);
    const sent = await s.api<{ message: Message }>("POST", path, { text: "Skip the beta" });
    expect(sent.status).toBe(201);
    await s.settle();

    const messages = await messagesOf(s, path);
    const reply = messages.find(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    const steer = messages.find((message) => message.id === sent.body.message.id);
    expect(steerPartsOf(reply)).toEqual([sent.body.message.id]);
    expect(steer).toMatchObject({ role: "user", text: "Skip the beta", steers: reply?.id });
    expect(reply?.blocks.at(-1)).toMatchObject({ type: "text" });
    expect(JSON.stringify(reply?.blocks)).toContain("Then you said: Skip the beta");
    expect((await runsOf(s, coordinator.id)).map((run) => run.status)).toEqual(["completed"]);
  }, 30_000);

  test("held for after the turn, it waits and gets a turn of its own", async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const project = await createProject(s);
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    if (!coordinator) throw new Error("no coordinator");
    const path = `/api/projects/${project.id}/messages`;

    await s.api("POST", path, { text: "Plan the release [fake: steps=2 delay=150]" });
    await cliStarted(s, coordinator.id);
    await s.api("POST", path, { text: "Then the changelog", midRunMode: "queue" });
    await s.settle();

    const messages = await messagesOf(s, path);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages.flatMap(steerPartsOf)).toEqual([]);
    expect((await runsOf(s, coordinator.id)).map((run) => run.status)).toEqual([
      "completed",
      "completed",
    ]);
  }, 30_000);
});

describe("thread_steer to a working thread", () => {
  test("reaches the thread's running turn, and the thread's reply shows where it took it in", async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const project = await createProject(s);
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    if (!coordinator) throw new Error("no coordinator");
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Build",
      prompt: "Build the image [fake: steps=3 delay=200]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    const threadId = spawned.thread.id;
    await cliStarted(s, threadId);

    const result = await s.callTool(coordinator.id, "thread_steer", {
      threadId,
      message: 'Use arm64 [fake: say="Built for arm64"]',
    });
    expect(result.isError).toBeFalsy();
    await s.settle();

    const messages = await messagesOf(s, `/api/threads/${threadId}/messages`);
    const replies = messages.filter(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    // The thread's one reply, with the coordinator's steer inside it.
    expect(replies).toHaveLength(1);
    const reply = replies.at(-1);
    const [steerId] = steerPartsOf(reply);
    const relayed = messages.find((message) => message.id === steerId);
    expect(relayed).toMatchObject({ role: "user", sender: "coordinator", steers: reply?.id });
    expect(JSON.stringify(reply?.blocks)).toContain("Built for arm64");
    expect((await runsOf(s, threadId)).map((run) => run.status)).toEqual(["completed"]);
    const thread = (await s.api<{ thread: Thread }>("GET", `/api/threads/${threadId}`)).body.thread;
    expect(thread.repliesCount).toBe(1);
  }, 30_000);
});
