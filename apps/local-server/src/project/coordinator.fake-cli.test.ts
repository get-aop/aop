import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Message, Project, Thread } from "@aop/common";
import { ClaudeCodeProvider } from "@aop/llm-provider";
import { createProjectStack, eventually, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// Drives the whole backend the way a person would, with the fake CLI standing in for Claude: a
// message to the coordinator, the coordinator calling AOP MCP tools over real HTTP, threads
// running, asking, reporting, and being resumed. The engine, adapter, spawn path, MCP endpoint,
// database and event log are all real.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const calls = (...items: Array<{ name: string; arguments: Record<string, unknown> }>): string =>
  `[fake: calls='${JSON.stringify(items)}']`;

const createProject = async (s: ProjectStack): Promise<Project> => {
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Checkout",
    repoIds: s.repos.map((repo) => repo.id),
  });
  expect(created.status).toBe(201);
  return created.body.project;
};

const threadsOf = async (s: ProjectStack, projectId: string): Promise<Thread[]> =>
  (await s.api<{ threads: Thread[] }>("GET", `/api/projects/${projectId}/threads`)).body.threads;

const messagesOf = async (s: ProjectStack, path: string): Promise<Message[]> =>
  (await s.api<{ messages: Message[] }>("GET", path)).body.messages;

describe("coordinator and threads against the fake CLI", () => {
  test("the coordinator spawns a thread; the thread asks; the answer resumes the same runtime session", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const project = await createProject(stack);
    const brief = `Pick a database [fake: ask="Which one?" options="a|b"]`;

    const sent = await stack.api("POST", `/api/projects/${project.id}/messages`, {
      text: `Start a thread on the database question. ${calls({
        name: "thread_spawn",
        arguments: { title: "Pick a database", prompt: brief },
      })}`,
    });
    expect(sent.status).toBe(201);

    const waiting = await eventually(async () => {
      const [thread] = await threadsOf(stack as ProjectStack, project.id);
      return thread?.status === "waiting-on-you" ? thread : undefined;
    }, "the thread to ask its question");
    expect(waiting.title).toBe("Pick a database");
    expect(waiting.status === "waiting-on-you" && waiting.blockedQuestion).toEqual({
      question: "Which one?",
      options: [
        { label: "a", recommended: false },
        { label: "b", recommended: false },
      ],
    });

    const firstSession = (await stack.ctx.chatSessionRepository.getById(waiting.id))
      ?.runtime_session_id;
    expect(firstSession).toMatch(/^[0-9a-f-]{36}$/);

    const replied = await stack.api<{ thread: Thread }>(
      "POST",
      `/api/threads/${waiting.id}/reply`,
      {
        text: "b",
      },
    );
    expect(replied.status).toBe(200);
    await stack.settle();

    const resumed = await eventually(async () => {
      const thread = (await stack?.services.threads.get(waiting.id)) ?? undefined;
      return thread?.success && thread.thread.status !== "working" ? thread.thread : undefined;
    }, "the thread to finish the resumed turn");
    expect(resumed.status).not.toBe("waiting-on-you");
    expect((await stack.ctx.chatSessionRepository.getById(waiting.id))?.runtime_session_id).toBe(
      firstSession ?? null,
    );
    const transcript = await messagesOf(stack, `/api/threads/${waiting.id}/messages`);
    const last = transcript.at(-1);
    expect(last?.role === "assistant" && JSON.stringify(last.blocks)).toContain("turn 2");
    expect(last?.role === "assistant" && JSON.stringify(last.blocks)).toContain("(resumed)");
  }, 60_000);

  test("a thread reports steps and a status line through its tool, and finishing the checklist makes it ready for review", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await createProject(s);
    const report = calls({
      name: "aop_report_status",
      arguments: {
        line: "Patched and verified",
        steps: [
          { label: "Profile", state: "done" },
          { label: "Patch", state: "done" },
        ],
      },
    });

    const spawned = await s.services.threads.spawn(project.id, {
      title: "Fix cold start",
      prompt: `Fix it ${report}`,
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const thread = await s.services.threads.get(spawned.thread.id);
    expect(thread.success && thread.thread).toMatchObject({
      status: "ready-for-review",
      liveStatusLine: "Patched and verified",
      steps: [
        { label: "Profile", state: "done" },
        { label: "Patch", state: "done" },
      ],
    });
  }, 60_000);

  test("the coordinator routes to an existing thread and proposes others; its reply carries the receipt and the proposals", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await createProject(s);
    const spawned = await s.services.threads.spawn(project.id, { title: "Audit", prompt: "Audit" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: `Tell the audit thread to include the backoff, and suggest two more. ${calls(
        {
          name: "thread_steer",
          arguments: {
            threadId: spawned.thread.id,
            message: "Include the backoff",
            quote: "and the backoff",
          },
        },
        {
          name: "propose_threads",
          arguments: {
            threads: [
              { title: "Add retry metrics", prompt: "Add metrics to every retry" },
              { title: "Load test", prompt: "Load test checkout", repoId: s.repos[0]?.id },
            ],
          },
        },
      )}`,
    });
    await s.settle();

    const messages = await messagesOf(s, `/api/projects/${project.id}/messages`);
    const reply = messages.find(
      (message) =>
        message.role === "assistant" &&
        message.blocks.some((block) => block.type === "suggested-threads"),
    );
    expect(reply?.role === "assistant" && reply.blocks.map((block) => block.type)).toEqual([
      "text",
      "routing-receipt",
      "suggested-threads",
    ]);
    const blocks = reply?.role === "assistant" ? reply.blocks : [];
    expect(blocks[1]).toEqual({ type: "routing-receipt", count: 1 });
    const suggestions = blocks[2]?.type === "suggested-threads" ? blocks[2].suggestions : [];
    expect(suggestions.map((suggestion) => suggestion.title)).toEqual([
      "Add retry metrics",
      "Load test",
    ]);
    expect(new Set(suggestions.map((suggestion) => suggestion.id)).size).toBe(2);

    const started = await s.api<{ thread: Thread }>("POST", `/api/projects/${project.id}/threads`, {
      title: suggestions[1]?.title,
      prompt: suggestions[1]?.prompt,
      repoId: suggestions[1]?.repoId,
    });
    expect(started.status).toBe(201);
    await s.settle();
    expect(await threadsOf(s, project.id)).toHaveLength(2);
  }, 60_000);

  test("the coordinator saves to project memory, and the next thread is briefed with it", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await createProject(s);

    await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: `Remember the payments rule. ${calls({
        name: "memory_write",
        arguments: { name: "MEMORY.md", body: "- Payments: the ledger is append-only" },
      })}`,
    });
    await s.settle();
    const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt: "Do it" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const memory = await s.services.memory.read(project.id, "MEMORY.md");
    expect(memory.success && memory.file.body).toBe("- Payments: the ledger is append-only");
    const threadRun = s.runs.find((run) => run.env?.AOP_CHAT_SESSION_ID === spawned.thread.id);
    expect(threadRun?.prompt).toContain("- Payments: the ledger is append-only");
  }, 60_000);

  test("a thread cannot use the coordinator's tools: the CLI is told the tool does not exist", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await createProject(s);

    const spawned = await s.services.threads.spawn(project.id, {
      title: "Sneaky",
      prompt: `Start more threads ${calls({ name: "thread_spawn", arguments: { prompt: "another" } })}`,
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const run = s.runs.find(
      (candidate) => candidate.env?.AOP_CHAT_SESSION_ID === spawned.thread.id,
    );
    const log = readFileSync(run?.logFilePath ?? "", "utf8");
    expect(log).toContain("No such tool available: mcp__aop__thread_spawn");
    expect(await threadsOf(s, project.id)).toHaveLength(1);
  }, 60_000);

  test("the coordinator run is hermetic with the AOP tools only, and a thread's run is open with its own", async () => {
    stack = await createProjectStack(home.path(), { mcp: true });
    const s = stack;
    const project = await createProject(s);
    await s.api("POST", `/api/projects/${project.id}/messages`, { text: "hello" });
    await s.settle();
    const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt: "Do it" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    const coordinatorRun = s.runs.find((run) => run.env?.AOP_CHAT_SESSION_ID === coordinator?.id);
    const threadRun = s.runs.find((run) => run.env?.AOP_CHAT_SESSION_ID === spawned.thread.id);
    expect(coordinatorRun).toMatchObject({
      isolation: "hermetic",
      accessMode: "approval-required",
      builtInTools: [],
      cwd: coordinator?.workspace_path,
      model: "fake-model",
    });
    expect(coordinatorRun?.allowedDirectories).toBeUndefined();
    // What the engine really handed the adapter: nothing on the command line skips permissions.
    if (!coordinatorRun) throw new Error("the coordinator did not run");
    const command = new ClaudeCodeProvider().buildCommand(coordinatorRun);
    expect(command).not.toContain("--dangerously-skip-permissions");
    expect(command).not.toContain("--permission-mode");
    expect(new URL(coordinatorRun?.mcpServerUrl ?? "").searchParams.get("sessionId")).toBe(
      coordinator?.id ?? "",
    );
    expect(threadRun).toMatchObject({ isolation: "open", disallowedTools: ["AskUserQuestion"] });
    expect(threadRun?.builtInTools).toBeUndefined();
    expect(threadRun?.allowedTools).toContain("mcp__aop__aop_ask_user");
    expect(threadRun?.allowedTools).not.toContain("mcp__aop__thread_spawn");
  }, 60_000);
});
