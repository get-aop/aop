import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Project, ProjectSettings, RuntimePreferenceInput } from "@aop/common";
import { ClaudeCodeProvider, type RunOptions } from "@aop/llm-provider";
import { FAKE_CLI_PATH, readLaunches } from "@aop/llm-provider/test-fixtures";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { createUsageService } from "../usage/service.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// A role set to "Use default" must not pass --model or --effort: Claude Code decides, so a plan
// without AOP's catalog model still gets a run. Everything from the chat engine down to the
// spawn is real; only the CLI is the fake, and it records the flags each launch really received.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const DEFAULT: RuntimePreferenceInput = { provider: "claude-code", model: null, effort: null };
const explicit = (
  model: string,
  effort: RuntimePreferenceInput["effort"],
): RuntimePreferenceInput => ({
  provider: "claude-code",
  model,
  effort,
});

// The fake's model that lists effort levels, next to the seeded one that lists none.
const THINKER = "fake-thinker";

const setup = async (settings: Partial<ProjectSettings>) => {
  const s = await createProjectStack(home.path(), { mcp: true });
  stack = s;
  const configurations = createRuntimeConfigurationRepository(s.db);
  const fake = (await configurations.list()).find(
    (candidate) => candidate.command === FAKE_CLI_PATH,
  );
  if (!fake) throw new Error("the fake runtime should be registered");
  await configurations.createModel(fake.id, {
    description: "Fake thinker",
    model: THINKER,
    thinkingLevels: ["low", "medium", "high"],
  });
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Checkout",
    repoIds: s.repos.map((repo) => repo.id),
    ...settings,
  });
  expect(created.status).toBe(201);
  return { s, project: created.body.project };
};

const say = async (s: ProjectStack, project: Project, text: string) => {
  const sent = await s.api("POST", `/api/projects/${project.id}/messages`, { text });
  expect(sent.status).toBe(201);
  await s.settle();
};

const spawn = async (s: ProjectStack, project: Project, prompt: string) => {
  const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt });
  if (!spawned.success) throw new Error("thread not spawned");
  await s.settle();
  return spawned.thread.id;
};

const tell = async (s: ProjectStack, threadId: string, text: string) => {
  const sent = await s.api("POST", `/api/threads/${threadId}/messages`, { text });
  expect(sent.status).toBe(201);
  await s.settle();
};

/** What the engine asked the adapter for, in order, for one session. */
const runsOf = (s: ProjectStack, sessionId: string): RunOptions[] =>
  s.runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === sessionId);

/** What the fake CLI says it was launched with, from the file it keeps for the session. */
const launchesOf = async (s: ProjectStack, sessionId: string) => {
  const nativeId = (await s.ctx.chatSessionRepository.getById(sessionId))?.runtime_session_id;
  return readLaunches(join(home.path(), "fake-cli"), "claude", nativeId ?? "");
};

const coordinatorId = async (s: ProjectStack, project: Project): Promise<string> => {
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
  if (!coordinator) throw new Error("the project should have a coordinator");
  return coordinator.id;
};

const modelsUsedBy = async (s: ProjectStack, sessionId: string): Promise<string[]> => {
  const runs = await s.db
    .selectFrom("chat_runs")
    .select("id")
    .where("session_id", "=", sessionId)
    .execute();
  const usage = createUsageService(s.db);
  const perRun = await Promise.all(runs.map((run) => usage.getRunUsage(run.id)));
  return [...new Set(perRun.flatMap((run) => run?.byModel.map((entry) => entry.model) ?? []))];
};

describe("a project whose roles are on default", () => {
  test("the coordinator passes no --model and no --effort, on its first turn and on the resume", async () => {
    const { s, project } = await setup({ coordinator: DEFAULT, thread: DEFAULT });

    await say(s, project, "hello [fake: usage=100,20,0,0]");
    await say(s, project, "and again");

    const id = await coordinatorId(s, project);
    const runs = runsOf(s, id);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.model).toBeUndefined();
      expect(run.reasoningEffort).toBeUndefined();
      const command = new ClaudeCodeProvider().buildCommand(run);
      expect(command).not.toContain("--model");
      expect(command).not.toContain("--effort");
    }
    expect(runs[1]?.resumeSessionId).toBeDefined();
    // The CLI itself was launched without them, both times, and the second one resumed.
    const launches = await launchesOf(s, id);
    expect(launches.map(({ model, effort }) => ({ model, effort }))).toEqual([
      { model: null, effort: null },
      { model: null, effort: null },
    ]);
    expect(launches.map((launch) => launch.flags.includes("--resume"))).toEqual([false, true]);
    for (const { flags } of launches) expect(flags).not.toContain("--model");
    // The turn ran: the coordinator's reply is in its conversation.
    const reply = await s.api<{ messages: { role: string }[] }>(
      "GET",
      `/api/projects/${project.id}/messages`,
    );
    expect(reply.body.messages.filter((message) => message.role === "assistant")).toHaveLength(2);
  }, 60_000);

  test("a thread passes none either, on its first turn and when it is told more", async () => {
    const { s, project } = await setup({ coordinator: DEFAULT, thread: DEFAULT });

    const threadId = await spawn(s, project, "Fix it [fake: usage=1000,200,0,0]");
    await tell(s, threadId, "and the other one too");

    const runs = runsOf(s, threadId);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.model).toBeUndefined();
      expect(run.reasoningEffort).toBeUndefined();
      const command = new ClaudeCodeProvider().buildCommand(run);
      expect(command).not.toContain("--model");
      expect(command).not.toContain("--effort");
    }
    const launches = await launchesOf(s, threadId);
    expect(launches.map(({ model, effort }) => ({ model, effort }))).toEqual([
      { model: null, effort: null },
      { model: null, effort: null },
    ]);
    expect(launches.map((launch) => launch.flags.includes("--resume"))).toEqual([false, true]);
    const session = await s.ctx.chatSessionRepository.getById(threadId);
    expect(session).toMatchObject({ model: null, reasoning_effort: null });
    const thread = await s.services.threads.get(threadId);
    // The project names no runtime, so it runs on the host's default: the fake.
    expect(thread.success && thread.thread.runtime).toEqual({
      ...DEFAULT,
      runtimeId: project.thread.runtimeId,
    });
    expect(project.thread.runtimeId).not.toBe("claude-code");
  }, 60_000);

  test("each role's first run on default reports the model it ran on, once, and still passes no flag", async () => {
    const { s, project } = await setup({ coordinator: DEFAULT, thread: DEFAULT });
    const reported = async () =>
      (await s.api<{ project: Project }>("GET", `/api/projects/${project.id}`)).body.project
        .reportedRuntime;
    const upserts = async () =>
      (
        await s.db
          .selectFrom("event_log")
          .select("id")
          .where("type", "=", "project.upserted")
          .execute()
      ).length;
    const nothing = { model: null, effort: null };
    expect(await reported()).toEqual({ coordinator: nothing, thread: nothing });

    const before = await upserts();
    await say(s, project, "hello");
    await say(s, project, "and again");
    // The fake reports `fake-claude` in its init event when no --model was passed, as Claude Code
    // names the model it picked; it names no effort, so none is reported.
    expect(await reported()).toEqual({
      coordinator: { model: "fake-claude", effort: null },
      thread: nothing,
    });
    // The second turn reported the same, so the stream heard of it once.
    expect((await upserts()) - before).toBe(1);

    const threadId = await spawn(s, project, "Fix it");
    expect((await reported()).thread).toEqual({ model: "fake-claude", effort: null });
    for (const id of [await coordinatorId(s, project), threadId]) {
      for (const { flags } of await launchesOf(s, id)) {
        expect(flags).not.toContain("--model");
        expect(flags).not.toContain("--effort");
      }
    }
  }, 60_000);

  test("usage is still attributed, to the model the run's own result names", async () => {
    const { s, project } = await setup({ coordinator: DEFAULT, thread: DEFAULT });

    const threadId = await spawn(s, project, "Fix it [fake: usage=1000,200,3000,50000]");

    // No flag named a model; the fake reports the label Claude Code would have chosen for itself.
    expect(await modelsUsedBy(s, threadId)).toEqual(["fake-claude"]);
    const [run] = await s.db
      .selectFrom("chat_runs")
      .select("id")
      .where("session_id", "=", threadId)
      .execute();
    const usage = await createUsageService(s.db).getRunUsage(run?.id ?? "");
    expect(usage?.totals).toMatchObject({
      inputTokens: 1000,
      outputTokens: 200,
      cacheWriteTokens: 3000,
      cacheReadTokens: 50_000,
    });
  }, 60_000);
});

describe("a project that names a model and an effort", () => {
  test("both roles pass them, as before", async () => {
    const { s, project } = await setup({
      coordinator: explicit(THINKER, "low"),
      thread: explicit(THINKER, "high"),
    });

    await say(s, project, "hello");
    const threadId = await spawn(s, project, "Fix it [fake: usage=1000,200,0,0]");
    await tell(s, threadId, "more");

    const coordinator = await coordinatorId(s, project);
    for (const [id, effort] of [
      [coordinator, "low"],
      [threadId, "high"],
    ] as const) {
      for (const run of runsOf(s, id)) {
        expect(run).toMatchObject({ model: THINKER, reasoningEffort: effort });
        const command = new ClaudeCodeProvider().buildCommand(run);
        expect(command.slice(command.indexOf("--model"), command.indexOf("--model") + 4)).toEqual([
          "--model",
          THINKER,
          "--effort",
          effort,
        ]);
      }
      const launches = await launchesOf(s, id);
      expect(launches.every((launch) => launch.model === THINKER && launch.effort === effort)).toBe(
        true,
      );
    }
    expect(
      (await launchesOf(s, threadId)).map((launch) => launch.flags.includes("--resume")),
    ).toEqual([false, true]);
    expect(await modelsUsedBy(s, threadId)).toEqual([THINKER]);
    // A run given its model says nothing about the default.
    const reported = await s.api<{ project: Project }>("GET", `/api/projects/${project.id}`);
    expect(reported.body.project.reportedRuntime).toEqual({
      coordinator: { model: null, effort: null },
      thread: { model: null, effort: null },
    });
  }, 60_000);

  test("naming only a model passes only --model, and only an effort passes only --effort", async () => {
    const { s, project } = await setup({
      coordinator: explicit(THINKER, null),
      thread: { provider: "claude-code", model: null, effort: "medium" },
    });

    await say(s, project, "hello");
    const threadId = await spawn(s, project, "Fix it");

    const [coordinatorLaunch] = await launchesOf(s, await coordinatorId(s, project));
    const [threadLaunch] = await launchesOf(s, threadId);
    expect(coordinatorLaunch).toMatchObject({ model: THINKER, effort: null });
    expect(coordinatorLaunch?.flags).not.toContain("--effort");
    // With no model named, the effort is judged against the configuration's default model, the
    // fake one that lists no levels, so there is nothing to apply it to.
    expect(threadLaunch).toMatchObject({ model: null, effort: null });
  }, 60_000);
});

describe("changing a project's models", () => {
  test("the coordinator's next turn follows the setting, both ways, on the same conversation", async () => {
    const { s, project } = await setup({ coordinator: DEFAULT, thread: DEFAULT });
    const change = async (coordinator: RuntimePreferenceInput) => {
      const patched = await s.api("PATCH", `/api/projects/${project.id}`, { coordinator });
      expect(patched.status).toBe(200);
    };

    await say(s, project, "on default");
    await change(explicit(THINKER, "high"));
    await say(s, project, "now named");
    await change(DEFAULT);
    await say(s, project, "default again");

    const launches = await launchesOf(s, await coordinatorId(s, project));
    expect(launches.map(({ turn, model, effort }) => ({ turn, model, effort }))).toEqual([
      { turn: 1, model: null, effort: null },
      { turn: 2, model: THINKER, effort: "high" },
      { turn: 3, model: null, effort: null },
    ]);
    // One conversation throughout: the turns after the first resumed it.
    expect(launches.map((launch) => launch.flags.includes("--resume"))).toEqual([
      false,
      true,
      true,
    ]);
  }, 60_000);

  test("a thread keeps what it started with; the next thread takes the new setting", async () => {
    const { s, project } = await setup({ coordinator: DEFAULT, thread: DEFAULT });

    const first = await spawn(s, project, "first");
    const patched = await s.api("PATCH", `/api/projects/${project.id}`, {
      thread: explicit(THINKER, "high"),
    });
    expect(patched.status).toBe(200);
    await tell(s, first, "more for the first");
    const second = await spawn(s, project, "second");

    expect((await launchesOf(s, first)).map(({ model, effort }) => ({ model, effort }))).toEqual([
      { model: null, effort: null },
      { model: null, effort: null },
    ]);
    expect(await launchesOf(s, second)).toMatchObject([{ model: THINKER, effort: "high" }]);
  }, 60_000);
});
