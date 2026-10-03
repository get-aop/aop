import { afterEach, describe, expect, test } from "bun:test";
import {
  type AssistantMessage,
  currentStepOf,
  type Message,
  type Project,
  type Thread,
} from "@aop/common";
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

/** The thread's long step is running: its live turn shows the call. */
const longStepRunning = async (s: ProjectStack, projectId: string, threadId: string) => {
  const [run] = await runsOf(s, threadId);
  if (!run) throw new Error("no run");
  return eventually(
    async () =>
      currentStepOf(s.ctx.eventPublisher.liveParts(projectId, run.assistant_message_id)) ??
      undefined,
    "the long step to run",
  );
};

const spawnHolding = async (s: ProjectStack) => {
  const project = await createProject(s);
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
  if (!coordinator) throw new Error("no coordinator");
  const spawned = await s.services.threads.spawn(project.id, {
    title: "Suite",
    prompt: "Run the suite [fake: hold=60000]",
  });
  if (!spawned.success) throw new Error("thread not spawned");
  await cliStarted(s, spawned.thread.id);
  await longStepRunning(s, project.id, spawned.thread.id);
  return { project, coordinator, threadId: spawned.thread.id };
};

describe("a message that waits behind a long step", () => {
  test("says which step it waits on, and Interrupt now gets it read at once", async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const { project, threadId } = await spawnHolding(s);
    const startedAt = Date.now();

    const sent = await s.services.threads.send(threadId, 'Stop, use arm64 [fake: say="Switched"]');
    if (!sent.success || !sent.messageId) throw new Error("not sent");
    const waiting = await s.services.chat.steerDelivery(sent.messageId);
    expect(waiting).toMatchObject({
      state: "waiting",
      step: { tool: { name: "Bash", detail: "sleep 60", status: "running" }, others: 0 },
    });

    const interrupted = await s.api<{ outcome: string }>(
      "POST",
      `/api/projects/${project.id}/messages/${sent.messageId}/interrupt`,
    );
    expect(interrupted).toMatchObject({ status: 200, body: { outcome: "interrupted" } });
    await s.settle();

    expect(Date.now() - startedAt).toBeLessThan(30_000);
    expect(await s.services.chat.steerDelivery(sent.messageId)).toEqual({ state: "delivered" });
    const messages = await messagesOf(s, `/api/threads/${threadId}/messages`);
    const replies = messages.filter(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    expect(replies).toHaveLength(1);
    expect(steerPartsOf(replies[0])).toEqual([sent.messageId]);
    expect(JSON.stringify(replies[0]?.blocks)).toContain("Switched");
    expect((await runsOf(s, threadId)).map((run) => run.status)).toEqual(["completed"]);

    // Once read, there is nothing left to stop.
    const again = await s.api<{ outcome: string }>(
      "POST",
      `/api/projects/${project.id}/messages/${sent.messageId}/interrupt`,
    );
    expect(again).toMatchObject({ status: 200, body: { outcome: "delivered" } });
  }, 45_000);

  test('thread_steer says where its message waits, and when: "interrupt" stops the step', async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const { coordinator, threadId } = await spawnHolding(s);

    const waits = await s.callTool(coordinator.id, "thread_steer", {
      threadId,
      message: "Note: arm64 later",
    });
    expect(JSON.parse(waits.content[0]?.text ?? "{}").delivery).toMatch(
      /^Written into its running turn: it reads the message once its current step ends \(Bash `sleep 60`, running \d+s\)/,
    );

    const stops = await s.callTool(coordinator.id, "thread_steer", {
      threadId,
      message: 'Stop now [fake: say="Stopped"]',
      when: "interrupt",
    });
    expect(JSON.parse(stops.content[0]?.text ?? "{}").delivery).toMatch(
      /^Interrupted the step it was on \(Bash `sleep 60`, running \d+s\): it reads the message now\.$/,
    );
    await s.settle();

    const messages = await messagesOf(s, `/api/threads/${threadId}/messages`);
    const reply = messages.find(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    expect(steerPartsOf(reply)).toHaveLength(2);
    expect(JSON.stringify(reply?.blocks)).toContain("Stopped");
  }, 45_000);
});
