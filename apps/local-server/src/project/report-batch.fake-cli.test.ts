import { afterEach, describe, expect, test } from "bun:test";
import type { Message, Project, Thread } from "@aop/common";
import type { LLMProvider, RunOptions } from "@aop/llm-provider";
import { cancelCoordinatorWakes } from "../chat-session/report-batch.ts";
import { createChatSessionService, shutdownChatSessions } from "../chat-session/service.ts";
import { createCommandContext } from "../context.ts";
import {
  createProjectStack,
  eventually,
  fakeOnlyClaude,
  type ProjectStack,
  useTempAopHome,
} from "./test-utils.ts";

// Several threads ending together are one wake of the coordinator, not one run each. The threads,
// the reports, the coordinator's inbox and its runs are all real; the fake CLI stands in for Claude.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  cancelCoordinatorWakes();
  await stack?.cleanup();
  stack = undefined;
});

const createProject = async (s: ProjectStack): Promise<Project> => {
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Checkout",
    repoIds: s.repos.map((repo) => repo.id),
  });
  expect(created.status).toBe(201);
  return created.body.project;
};

const spawnThreads = async (s: ProjectStack, projectId: string, words: string[]) =>
  Promise.all(
    words.map(async (word) => {
      const spawned = await s.services.threads.spawn(projectId, {
        title: `Thread ${word}`,
        prompt: `Work on ${word} [fake: say="${word} is done"]`,
      });
      if (!spawned.success) throw new Error(`thread ${word} was not spawned`);
      return spawned.thread;
    }),
  );

const coordinatorOf = async (s: ProjectStack, projectId: string) => {
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(projectId);
  if (!coordinator) throw new Error("the project has no coordinator");
  return coordinator;
};

const runsOf = (runs: RunOptions[], sessionId: string): RunOptions[] =>
  runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === sessionId);

const reportsIn = async (s: ProjectStack, projectId: string) =>
  (await s.api<{ messages: Message[] }>("GET", `/api/projects/${projectId}/messages`)).body.messages
    .filter((message) => message.role === "thread-report")
    .map((message) => (message.role === "thread-report" ? message.text : ""));

const waitingReports = async (s: ProjectStack, sessionId: string): Promise<number> => {
  const rows = await s.db
    .selectFrom("chat_messages")
    .select("id")
    .where("session_id", "=", sessionId)
    .where("role", "=", "user")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("chat_runs")
            .select("id")
            .whereRef("chat_runs.user_message_id", "=", "chat_messages.id"),
        ),
      ),
    )
    .execute();
  return rows.length;
};

describe("batched coordinator wakes", () => {
  test("three threads finishing together wake the coordinator once, and its prompt holds every report in order", async () => {
    stack = await createProjectStack(home.path(), { wakeWindowMs: 3_000 });
    const s = stack;
    const project = await createProject(s);
    const coordinator = await coordinatorOf(s, project.id);

    await spawnThreads(s, project.id, ["alpha", "bravo", "charlie"]);
    await s.settle();

    const runs = runsOf(s.runs, coordinator.id);
    expect(runs).toHaveLength(1);
    const prompt = runs[0]?.prompt ?? "";
    expect(prompt).toContain("3 thread reports arrived together");
    const reports = await reportsIn(s, project.id);
    expect(reports).toHaveLength(3);
    // Every report, in the order the coordinator's chat shows them.
    let from = 0;
    for (const [index, report] of reports.entries()) {
      const at = prompt.indexOf(`Report ${index + 1} of 3:\n${report}`, from);
      expect(at).toBeGreaterThanOrEqual(from);
      from = at;
    }
    for (const word of ["alpha", "bravo", "charlie"]) {
      expect(prompt).toContain(`${word} is done`);
    }

    // The coordinator answered once, and nothing is left waiting in its inbox.
    const messages = (
      await s.api<{ messages: Message[] }>("GET", `/api/projects/${project.id}/messages`)
    ).body.messages;
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(await waitingReports(s, coordinator.id)).toBe(0);
    const threads = (
      await s.api<{ threads: Thread[] }>("GET", `/api/projects/${project.id}/threads`)
    ).body.threads;
    expect(threads).toHaveLength(3);
  }, 60_000);

  test("threads the coordinator started, finishing around its own reply, are answered by one more run", async () => {
    stack = await createProjectStack(home.path(), { mcp: true, wakeWindowMs: 1_500 });
    const s = stack;
    const project = await createProject(s);
    const coordinator = await coordinatorOf(s, project.id);
    const spawn = (word: string) => ({
      name: "thread_spawn",
      arguments: {
        title: `Thread ${word}`,
        prompt: `Work on ${word} [fake: say="${word} is done"]`,
      },
    });

    const sent = await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: `Start three threads. [fake: calls='${JSON.stringify(["lima", "mike", "november"].map(spawn))}']`,
    });
    expect(sent.status).toBe(201);
    await eventually(
      async () => ((await reportsIn(s, project.id)).length === 3 ? true : undefined),
      "all three reports",
    );
    await s.settle();

    const runs = runsOf(s.runs, coordinator.id);
    expect(runs).toHaveLength(2);
    for (const word of ["lima", "mike", "november"]) {
      expect(runs[1]?.prompt).toContain(`${word} is done`);
    }
    expect(runs[1]?.prompt).toContain("3 thread reports arrived together");
    expect(await waitingReports(s, coordinator.id)).toBe(0);

    // The reply reads after every report it answers, and carries the card of each thread.
    const messages = (
      await s.api<{ messages: Message[] }>("GET", `/api/projects/${project.id}/messages`)
    ).body.messages;
    const replies = messages.filter((message) => message.role === "assistant");
    const last = replies.at(-1);
    expect(messages.at(-1)).toEqual(last);
    // It says which message it answers, so a page that is already open puts it in the same place.
    const lastReport = messages.filter((message) => message.role === "thread-report").at(-1);
    expect(last?.role === "assistant" && last.inReplyTo).toBe(lastReport?.id);
    const cards =
      last?.role === "assistant" ? last.blocks.filter((b) => b.type === "thread-card") : [];
    expect(new Set(cards.map((card) => card.type === "thread-card" && card.threadId)).size).toBe(3);
  }, 60_000);

  test("reports that arrive while the coordinator is running are answered by one more run", async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const project = await createProject(s);
    const coordinator = await coordinatorOf(s, project.id);

    const sent = await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: "Keep me busy [fake: steps=6 delay=400]",
    });
    expect(sent.status).toBe(201);
    await eventually(
      () => (runsOf(s.runs, coordinator.id).length === 1 ? true : undefined),
      "the coordinator's first run to start",
    );

    await spawnThreads(s, project.id, ["delta", "echo"]);
    await eventually(
      async () => ((await reportsIn(s, project.id)).length === 2 ? true : undefined),
      "both reports",
    );
    // Still in the first run: neither report started a run of its own.
    expect(runsOf(s.runs, coordinator.id)).toHaveLength(1);
    expect(await waitingReports(s, coordinator.id)).toBe(2);
    await s.settle();

    const runs = runsOf(s.runs, coordinator.id);
    expect(runs).toHaveLength(2);
    const batched = runs[1]?.prompt ?? "";
    expect(batched).toContain("2 thread reports arrived together");
    expect(batched).toContain("delta is done");
    expect(batched).toContain("echo is done");
    expect(await waitingReports(s, coordinator.id)).toBe(0);
  }, 60_000);

  test("a message from the person ends a batch: it is read in order and gets its own turn", async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const project = await createProject(s);
    const coordinator = await coordinatorOf(s, project.id);

    await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: "Busy [fake: steps=6 delay=400]",
    });
    await eventually(
      () => (runsOf(s.runs, coordinator.id).length === 1 ? true : undefined),
      "the first run to start",
    );
    await spawnThreads(s, project.id, ["foxtrot"]);
    await eventually(
      async () => ((await reportsIn(s, project.id)).length === 1 ? true : undefined),
      "a report",
    );
    await s.api("POST", `/api/projects/${project.id}/messages`, { text: "And then this question" });
    await spawnThreads(s, project.id, ["golf"]);
    await eventually(
      async () => ((await reportsIn(s, project.id)).length === 2 ? true : undefined),
      "the second report",
    );
    await s.settle();

    const prompts = runsOf(s.runs, coordinator.id).map((run) => run.prompt);
    expect(prompts).toHaveLength(4);
    expect(prompts[1]).toContain("foxtrot is done");
    expect(prompts[1]).not.toContain("arrived together");
    expect(prompts[2]).toContain("And then this question");
    expect(prompts[3]).toContain("golf is done");
  }, 60_000);

  test("reports waiting when the server stops are all started as one run at boot", async () => {
    stack = await createProjectStack(home.path(), { wakeWindowMs: 60_000 });
    const s = stack;
    const project = await createProject(s);
    const coordinator = await coordinatorOf(s, project.id);

    await spawnThreads(s, project.id, ["hotel", "india"]);
    await eventually(
      async () => ((await reportsIn(s, project.id)).length === 2 ? true : undefined),
      "both reports",
    );
    // The process ends with its wake still waiting out the window: only the stored reports remain.
    cancelCoordinatorWakes();
    expect(runsOf(s.runs, coordinator.id)).toHaveLength(0);
    expect(await waitingReports(s, coordinator.id)).toBe(2);

    const booted: RunOptions[] = [];
    const provider: LLMProvider = {
      name: "claude-code",
      run: (options) => {
        booted.push(options);
        return fakeOnlyClaude.run(options);
      },
    };
    createChatSessionService(s.ctx, { createProviderFn: () => provider });
    await eventually(
      () => (booted.length > 0 ? true : undefined),
      "the boot to start the coordinator",
    );
    await s.settle();

    expect(booted).toHaveLength(1);
    expect(booted[0]?.prompt).toContain("2 thread reports arrived together");
    expect(booted[0]?.prompt).toContain("hotel is done");
    expect(booted[0]?.prompt).toContain("india is done");
    expect(await waitingReports(s, coordinator.id)).toBe(0);
  }, 60_000);

  test("a graceful stop while the coordinator runs keeps the reports behind it, and boot answers them as one run", async () => {
    stack = await createProjectStack(home.path());
    const s = stack;
    const project = await createProject(s);
    const coordinator = await coordinatorOf(s, project.id);

    await s.api("POST", `/api/projects/${project.id}/messages`, {
      text: "Busy [fake: steps=8 delay=400]",
    });
    await eventually(
      () => (runsOf(s.runs, coordinator.id).length === 1 ? true : undefined),
      "the coordinator's first run to start",
    );
    await spawnThreads(s, project.id, ["juliet", "kilo"]);
    await eventually(
      async () => ((await reportsIn(s, project.id)).length === 2 ? true : undefined),
      "both reports",
    );

    await shutdownChatSessions(s.ctx);

    // The interrupted run is over; the reports did not start a run and were not thrown away.
    expect(runsOf(s.runs, coordinator.id)).toHaveLength(1);
    expect(await waitingReports(s, coordinator.id)).toBe(2);

    const booted: RunOptions[] = [];
    const provider: LLMProvider = {
      name: "claude-code",
      run: (options) => {
        booted.push(options);
        return fakeOnlyClaude.run(options);
      },
    };
    createChatSessionService(createCommandContext(s.db), { createProviderFn: () => provider });
    await eventually(() => (booted.length > 0 ? true : undefined), "the boot to start the reports");
    await s.settle();

    expect(booted).toHaveLength(1);
    expect(booted[0]?.prompt).toContain("juliet is done");
    expect(booted[0]?.prompt).toContain("kilo is done");
    expect(await waitingReports(s, coordinator.id)).toBe(0);
  }, 60_000);
});
