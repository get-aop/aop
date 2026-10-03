import { afterEach, describe, expect, test } from "bun:test";
import type { Project, RuntimePreferenceInput } from "@aop/common";
import type { RunOptions } from "@aop/llm-provider";
import { FAKE_CLI_PATH } from "@aop/llm-provider/test-fixtures";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { SettingKey } from "../settings/types.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// A project names the runtime each role runs on. Two runtimes here both launch the fake CLI (the
// suite never spawns anything else), and each offers a model of its own, so the model a launch
// asks for shows which runtime it ran on.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path(), { mcp: true });
  stack = s;
  const configurations = createRuntimeConfigurationRepository(s.db);
  const wrapper = await configurations.createProvider({
    name: "Wrapper",
    command: FAKE_CLI_PATH,
    driver: "claude-code",
  });
  await configurations.createModel(wrapper.id, {
    description: "Wrapper model",
    model: "wrapper-model",
    thinkingLevels: [],
  });
  const fakeId = await s.ctx.settingsRepository.get(SettingKey.DEFAULT_RUNTIME);
  return { s, wrapperId: wrapper.id, fakeId };
};

const role = (runtimeId?: string, model: string | null = null): RuntimePreferenceInput => ({
  provider: "claude-code",
  ...(runtimeId && { runtimeId }),
  model,
  effort: null,
});

const create = async (s: ProjectStack, body: Record<string, unknown>) =>
  s.api<{ project: Project; error?: string }>("POST", "/api/projects", {
    name: "Checkout",
    ...body,
  });

const runsOf = (s: ProjectStack, sessionId: string): RunOptions[] =>
  s.runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === sessionId);

const coordinatorOf = async (s: ProjectStack, project: Project) => {
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
  if (!coordinator) throw new Error("the project should have a coordinator");
  return coordinator;
};

describe("choosing a project's runtimes", () => {
  test("a new project that names none starts on the host's default runtime", async () => {
    const { s, fakeId } = await setup();

    const created = await create(s, {});

    expect(created.status).toBe(201);
    expect(created.body.project.coordinator.runtimeId).toBe(fakeId);
    expect(created.body.project.thread.runtimeId).toBe(fakeId);
    expect((await coordinatorOf(s, created.body.project)).runtime_configuration_id).toBe(fakeId);
  });

  test("a project that names a runtime per role runs each role on it", async () => {
    const { s, wrapperId, fakeId } = await setup();

    const created = await create(s, {
      coordinator: role(wrapperId, "wrapper-model"),
      thread: role(fakeId),
      repoIds: [s.repos[0]?.id],
    });
    const { project } = created.body;
    const coordinator = await coordinatorOf(s, project);
    await s.api("POST", `/api/projects/${project.id}/messages`, { text: "hello" });
    await s.settle();

    expect(project.coordinator.runtimeId).toBe(wrapperId);
    expect(coordinator.runtime_configuration_id).toBe(wrapperId);
    expect(runsOf(s, coordinator.id).map((run) => run.model)).toEqual(["wrapper-model"]);
  }, 60_000);

  test("a runtime that does not exist is refused with a sentence that says so", async () => {
    const { s } = await setup();

    const refused = await create(s, { thread: role("rtprov_gone") });

    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(
      "Runtime not found: rtprov_gone. Pick one listed in AOP settings › Runtimes",
    );
  });

  test("a change that names no runtime keeps the role's runtime; one that names another moves it", async () => {
    const { s, wrapperId, fakeId } = await setup();
    const { project } = (await create(s, { coordinator: role(wrapperId) })).body;

    const modelOnly = await s.api<{ project: Project }>("PATCH", `/api/projects/${project.id}`, {
      coordinator: role(undefined, "wrapper-model"),
    });
    expect(modelOnly.body.project.coordinator).toMatchObject({
      runtimeId: wrapperId,
      model: "wrapper-model",
    });

    const moved = await s.api<{ project: Project }>("PATCH", `/api/projects/${project.id}`, {
      coordinator: role(fakeId),
    });
    expect(moved.body.project.coordinator.runtimeId).toBe(fakeId);
    // The coordinator's session follows at once; its next turn launches the new runtime.
    expect((await coordinatorOf(s, project)).runtime_configuration_id).toBe(fakeId);
  });

  test("a thread keeps the runtime it started on when the project's thread runtime changes", async () => {
    const { s, wrapperId, fakeId } = await setup();
    const { project } = (
      await create(s, { thread: role(wrapperId, "wrapper-model"), repoIds: [s.repos[0]?.id] })
    ).body;
    const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt: "go" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    await s.api("PATCH", `/api/projects/${project.id}`, { thread: role(fakeId) });
    await s.api("POST", `/api/threads/${spawned.thread.id}/messages`, { text: "more" });
    await s.settle();

    const thread = await s.services.threads.get(spawned.thread.id);
    expect(thread.success && thread.thread.runtime.runtimeId).toBe(wrapperId);
    expect(runsOf(s, spawned.thread.id).map((run) => run.model)).toEqual([
      "wrapper-model",
      "wrapper-model",
    ]);
  }, 60_000);
});
