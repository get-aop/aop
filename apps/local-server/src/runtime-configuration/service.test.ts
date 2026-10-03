import { afterEach, describe, expect, test } from "bun:test";
import type { Project } from "@aop/common";
import { FAKE_CLI_PATH } from "@aop/llm-provider/test-fixtures";
import { createRuntimeUsers } from "../project/runtime-users.ts";
import {
  createProjectStack,
  insertProjectSession,
  type ProjectStack,
  useTempAopHome,
} from "../project/test-utils.ts";
import { SettingKey } from "../settings/types.ts";
import { createRuntimeReadiness } from "./readiness.ts";
import { createRuntimeConfigurationRepository } from "./repository.ts";
import { createRuntimeConfigurationService } from "./service.ts";

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const NOTHING_RUNS = createRuntimeReadiness({
  locate: () => null,
  run: async () => ({ exitCode: 1, output: "" }),
  now: () => 0,
});

const setup = async () => {
  const s = await createProjectStack(home.path());
  stack = s;
  const configurations = createRuntimeConfigurationRepository(s.db);
  const service = createRuntimeConfigurationService(
    s.ctx,
    createRuntimeUsers(s.ctx, s.services.projects),
    NOTHING_RUNS,
  );
  // A second fake, so moving off a runtime still lands on one that runs the fake CLI.
  const wrapper = await configurations.createProvider({
    name: "Wrapper",
    command: FAKE_CLI_PATH,
    driver: "claude-code",
  });
  await configurations.createModel(wrapper.id, {
    description: "Fake model",
    model: "fake-model",
    thinkingLevels: [],
  });
  const defaultRuntimeId = await s.ctx.settingsRepository.get(SettingKey.DEFAULT_RUNTIME);
  return { s, service, configurations, wrapper, defaultRuntimeId };
};

const createProject = async (
  s: ProjectStack,
  name: string,
  runtimes: { coordinator?: string; thread?: string } = {},
): Promise<Project> => {
  const role = (runtimeId: string | undefined, effort: "low" | "high") => ({
    provider: "claude-code",
    ...(runtimeId && { runtimeId }),
    model: null,
    effort,
  });
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name,
    coordinator: role(runtimes.coordinator, "low"),
    thread: role(runtimes.thread, "high"),
  });
  expect(created.status).toBe(201);
  return created.body.project;
};

describe("removing a runtime", () => {
  test("is refused while projects name it or open threads run on it, with the list", async () => {
    const { s, service, wrapper } = await setup();
    const coordinatorOn = await createProject(s, "Checkout", { coordinator: wrapper.id });
    const threadsOn = await createProject(s, "Billing", { thread: wrapper.id });
    const runningOn = await createProject(s, "Search");
    await createProject(s, "Docs");
    await insertProjectSession(
      s.db,
      { id: "isess_open", projectId: runningOn.id, kind: "thread" },
      { runtime_configuration_id: wrapper.id },
    );
    await insertProjectSession(
      s.db,
      { id: "isess_done", projectId: runningOn.id, kind: "thread" },
      {
        runtime_configuration_id: wrapper.id,
        state: "resolved",
        resolved_at: "2026-10-03T00:00:00.000Z",
      },
    );

    const refused = await service.remove(wrapper.id);
    expect((await service.usage(wrapper.id)).map((entry) => entry.projectName)).toEqual([
      "Checkout",
      "Billing",
      "Search",
    ]);

    expect(refused).toEqual({
      success: false,
      error: {
        code: "RUNTIME_IN_USE",
        usage: [
          {
            projectId: coordinatorOn.id,
            projectName: "Checkout",
            roles: ["coordinator"],
            openThreads: 0,
          },
          { projectId: threadsOn.id, projectName: "Billing", roles: ["threads"], openThreads: 0 },
          { projectId: runningOn.id, projectName: "Search", roles: [], openThreads: 1 },
        ],
      },
    });
    expect(await s.services.projects.get(coordinatorOn.id)).toMatchObject({
      project: { coordinator: { runtimeId: wrapper.id } },
    });
  });

  test("moves everything on it to the host's default first when asked, then removes it", async () => {
    const { s, service, configurations, wrapper, defaultRuntimeId } = await setup();
    const project = await createProject(s, "Checkout", {
      coordinator: wrapper.id,
      thread: wrapper.id,
    });
    await insertProjectSession(
      s.db,
      { id: "isess_done", projectId: project.id, kind: "thread" },
      {
        runtime_configuration_id: wrapper.id,
        state: "resolved",
        resolved_at: "2026-10-03T00:00:00.000Z",
      },
    );

    expect(await service.remove(wrapper.id, { moveToDefault: true })).toEqual({ success: true });

    const moved = await s.services.projects.get(project.id);
    expect(
      moved.success && [moved.project.coordinator.runtimeId, moved.project.thread.runtimeId],
    ).toEqual([defaultRuntimeId, defaultRuntimeId]);
    // The coordinator follows its project, and no session is left on a runtime that is gone.
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    expect(coordinator?.runtime_configuration_id).toBe(defaultRuntimeId);
    expect(
      (await s.ctx.chatSessionRepository.getById("isess_done"))?.runtime_configuration_id,
    ).toBe(defaultRuntimeId);
    expect(await configurations.get(wrapper.id)).toBeNull();
  });

  test("removing the host's default moves its users to the built-in one and resets the default", async () => {
    const { s, service, wrapper } = await setup();
    await service.setDefault(wrapper.id);
    const project = await createProject(s, "Checkout");
    expect(project.coordinator.runtimeId).toBe(wrapper.id);

    expect(await service.remove(wrapper.id, { moveToDefault: true })).toEqual({ success: true });

    expect(await s.ctx.settingsRepository.get(SettingKey.DEFAULT_RUNTIME)).toBe("claude-code");
    const moved = await s.services.projects.get(project.id);
    expect(moved.success && moved.project.thread.runtimeId).toBe("claude-code");
  });

  test("an unused custom runtime goes at once; the built-in one never does", async () => {
    const { s, service, wrapper } = await setup();
    await createProject(s, "Checkout");

    expect(await service.remove(wrapper.id)).toEqual({ success: true });
    expect(await service.remove("claude-code")).toEqual({
      success: false,
      error: { code: "RUNTIME_NOT_FOUND" },
    });
  });
});
