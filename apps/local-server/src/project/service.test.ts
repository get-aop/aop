import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import {
  createProjectStack,
  eventually,
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

const setup = async (options: { repos?: number } = {}) => {
  const s = await createProjectStack(home.path(), options);
  stack = s;
  const created = await s.services.projects.create(
    projectSettings({ repoIds: s.repos.map((repo) => repo.id) }),
  );
  if (!created.success) throw new Error("project not created");
  return { s, project: created.project };
};

const eventTypes = async (s: ProjectStack): Promise<string[]> =>
  (await s.db.selectFrom("event_log").select("type").orderBy("id").execute()).map(
    (row) => row.type,
  );

describe("creating a project", () => {
  test("stores the project active, with its coordinator session ready to talk", async () => {
    const { s, project } = await setup();

    expect(project).toMatchObject({ status: "active", name: "Checkout revamp" });
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    expect(coordinator).toMatchObject({
      kind: "coordinator",
      project_id: project.id,
      repo_id: null,
      state: null,
      // The project's coordinator model is on default, so the session names none.
      model: null,
      runtime_access_mode: "approval-required",
      runtime_session_id: null,
    });
    expect(coordinator?.workspace_path).toContain(join("projects", project.id, "coordinator"));
    expect(existsSync(coordinator?.workspace_path ?? "")).toBe(true);
  });

  test("appends project.upserted to the event log in the same transaction", async () => {
    const { s, project } = await setup();

    const entries = await s.db.selectFrom("event_log").selectAll().execute();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ project_id: project.id, type: "project.upserted" });
    expect(JSON.parse(entries[0]?.payload ?? "{}")).toMatchObject({
      project: { id: project.id, name: "Checkout revamp", status: "active" },
    });
  });

  test("refuses a repo that is not registered and leaves nothing behind", async () => {
    const s = await createProjectStack(home.path());
    stack = s;

    const created = await s.services.projects.create(projectSettings({ repoIds: ["repo_nope"] }));

    expect(created).toEqual({
      success: false,
      error: { code: "REPO_NOT_FOUND", repoId: "repo_nope" },
    });
    expect(await s.services.projects.list()).toEqual([]);
    expect(await s.db.selectFrom("chat_sessions").select("id").execute()).toEqual([]);
    expect(await eventTypes(s)).toEqual([]);
  });

  test("runs the coordinator on the runtime its setting asks for", async () => {
    const s = await createProjectStack(home.path());
    stack = s;
    const configurations = createRuntimeConfigurationRepository(s.db);
    const fake = (await configurations.list()).find((config) => config.name === "Fake CLI");
    await configurations.createModel(fake?.id ?? "", {
      description: "Second",
      model: "fake-model-2",
      thinkingLevels: [],
    });

    const created = await s.services.projects.create(
      projectSettings({
        coordinator: { provider: "claude-code", model: "fake-model-2", effort: null },
      }),
    );

    if (!created.success) throw new Error("project not created");
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(created.project.id);
    expect(coordinator).toMatchObject({ model: "fake-model-2", runtime_alias: expect.any(String) });
  });
});

describe("updating a project", () => {
  test("changes only the settings sent, records it, and follows a rename and a new coordinator model", async () => {
    const { s, project } = await setup();
    const configurations = createRuntimeConfigurationRepository(s.db);
    const fake = (await configurations.list()).find((config) => config.name === "Fake CLI");
    await configurations.createModel(fake?.id ?? "", {
      description: "Second",
      model: "fake-model-2",
      thinkingLevels: [],
    });

    const updated = await s.services.projects.update(project.id, {
      name: "Checkout v2",
      goal: "New goal",
      coordinator: { provider: "claude-code", model: "fake-model-2", effort: null },
    });

    expect(updated.success && updated.project).toMatchObject({
      name: "Checkout v2",
      goal: "New goal",
      instructions: project.instructions,
      repoIds: project.repoIds,
    });
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    expect(coordinator).toMatchObject({ title: "Checkout v2", model: "fake-model-2" });
    expect(await eventTypes(s)).toEqual(["project.upserted", "project.upserted"]);
  });

  test("full access is opted into per project and reaches the threads it already has", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, { prompt: "work" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();
    expect(
      (await s.ctx.chatSessionRepository.getById(spawned.thread.id))?.runtime_access_mode,
    ).toBe("auto-accept-edits");

    await s.services.projects.update(project.id, { threadAccess: "full-access" });

    expect(
      (await s.ctx.chatSessionRepository.getById(spawned.thread.id))?.runtime_access_mode,
    ).toBe("full-access");
    // The opt-in is for threads; the coordinator stays where it was created.
    expect(
      (await s.ctx.chatSessionRepository.getCoordinator(project.id))?.runtime_access_mode,
    ).toBe("approval-required");
    const next = await s.services.threads.spawn(project.id, { prompt: "more work" });
    if (!next.success) throw new Error("thread not spawned");
    await s.settle();
    expect((await s.ctx.chatSessionRepository.getById(next.thread.id))?.runtime_access_mode).toBe(
      "full-access",
    );
  });

  test("refuses to take a repo away from a thread that works in it, and a repo that is not registered", async () => {
    const { s, project } = await setup({ repos: 2 });
    const spawned = await s.services.threads.spawn(project.id, {
      prompt: "work",
      repoId: s.repos[0]?.id,
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const usedRepo = s.repos[0]?.id ?? "";
    const otherRepo = s.repos[1]?.id ?? "";
    const inUse = await s.services.projects.update(project.id, { repoIds: [otherRepo] });
    const unknown = await s.services.projects.update(project.id, { repoIds: ["repo_nope"] });
    const fine = await s.services.projects.update(project.id, { repoIds: [usedRepo] });

    expect(inUse).toEqual({ success: false, error: { code: "REPO_IN_USE", repoId: usedRepo } });
    expect(unknown).toEqual({
      success: false,
      error: { code: "REPO_NOT_FOUND", repoId: "repo_nope" },
    });
    expect(fine.success && fine.project.repoIds).toEqual([usedRepo]);
  });

  test("an unknown project is not found", async () => {
    const s = await createProjectStack(home.path());
    stack = s;

    expect(await s.services.projects.update("proj_nope", { goal: "x" })).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_FOUND" },
    });
    expect(await s.services.projects.get("proj_nope")).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_FOUND" },
    });
  });
});

describe("pausing, archiving and restoring", () => {
  test("pause stops every running thread and refuses new work; resume reopens the project", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Long job",
      prompt: "long job [fake: delay=30000]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    const threadId = spawned.thread.id;
    await eventually(
      async () =>
        (await s.ctx.chatSessionRepository.getById(threadId))?.runtime_session_id ?? undefined,
      "the CLI to start",
    );

    const paused = await s.services.projects.transition(project.id, "pause");

    expect(paused.success && paused.project.status).toBe("paused");
    const stopped = await s.services.threads.get(threadId);
    expect(stopped.success && stopped.thread).toMatchObject({
      status: "idle",
      liveStatusLine: "Stopped",
    });
    const runs = await s.db.selectFrom("chat_runs").select("status").execute();
    expect(runs.map((run) => run.status)).toEqual(["cancelled"]);
    expect(await s.services.projects.sendToCoordinator(project.id, "hello")).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_ACTIVE", status: "paused" },
    });
    expect(await s.services.threads.spawn(project.id, { prompt: "more" })).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_ACTIVE", status: "paused" },
    });
    expect(await s.services.threads.send(threadId, "carry on")).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_ACTIVE", status: "paused" },
    });

    const resumed = await s.services.projects.transition(project.id, "resume");
    expect(resumed.success && resumed.project.status).toBe("active");
    expect((await s.services.threads.send(threadId, "carry on")).success).toBe(true);
    await s.settle();
  }, 30_000);

  test("a paused project's threads finishing do not wake its coordinator", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Long job",
      prompt: "long job [fake: delay=30000]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await eventually(
      async () =>
        (await s.ctx.chatSessionRepository.getById(spawned.thread.id))?.runtime_session_id ??
        undefined,
      "the CLI to start",
    );

    await s.services.projects.transition(project.id, "pause");
    await s.settle();

    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    expect(await s.ctx.chatSessionRepository.countMessages(coordinator?.id ?? "")).toBe(0);
  }, 30_000);

  test("archive works from active or paused, restore reopens it, and each is idempotent", async () => {
    const { s, project } = await setup();

    const archived = await s.services.projects.transition(project.id, "archive");
    const again = await s.services.projects.transition(project.id, "archive");
    const restored = await s.services.projects.transition(project.id, "restore");
    const restoredAgain = await s.services.projects.transition(project.id, "restore");

    expect(archived.success && archived.project.status).toBe("archived");
    expect(again.success && again.project.status).toBe("archived");
    expect(restored.success && restored.project.status).toBe("active");
    expect(restoredAgain.success && restoredAgain.project.status).toBe("active");
    // Idempotent calls change nothing, so they write no event.
    expect(await eventTypes(s)).toEqual([
      "project.upserted",
      "project.upserted",
      "project.upserted",
    ]);
  });

  test("refuses a transition the status does not allow", async () => {
    const { s, project } = await setup();
    await s.services.projects.transition(project.id, "archive");

    const pause = await s.services.projects.transition(project.id, "pause");
    const resume = await s.services.projects.transition(project.id, "resume");

    expect(pause).toEqual({
      success: false,
      error: { code: "INVALID_TRANSITION", action: "pause", status: "archived" },
    });
    expect(resume).toEqual({
      success: false,
      error: { code: "INVALID_TRANSITION", action: "resume", status: "archived" },
    });
  });
});

describe("restarting the coordinator", () => {
  test("drops the native session but keeps the conversation, and threads are untouched", async () => {
    const { s, project } = await setup();
    const spawned = await s.services.threads.spawn(project.id, { prompt: "work" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();
    await s.services.projects.sendToCoordinator(project.id, "first");
    await s.settle();
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    const before = coordinator?.id
      ? (await s.ctx.chatSessionRepository.getById(coordinator.id))?.runtime_session_id
      : null;
    expect(before).toMatch(/^[0-9a-f-]{36}$/);
    const threadSession = (await s.ctx.chatSessionRepository.getById(spawned.thread.id))
      ?.runtime_session_id;

    const restarted = await s.services.projects.restartCoordinator(project.id);

    expect(restarted.success).toBe(true);
    expect(
      (await s.ctx.chatSessionRepository.getById(coordinator?.id ?? ""))?.runtime_session_id,
    ).toBeNull();
    expect((await s.ctx.chatSessionRepository.getById(spawned.thread.id))?.runtime_session_id).toBe(
      threadSession ?? null,
    );
    await s.services.projects.sendToCoordinator(project.id, "second");
    await s.settle();
    const after = (await s.ctx.chatSessionRepository.getById(coordinator?.id ?? ""))
      ?.runtime_session_id;
    expect(after).toMatch(/^[0-9a-f-]{36}$/);
    expect(after).not.toBe(before);
    const messages = await s.services.projects.listMessages(project.id);
    const texts = messages.success ? messages.messages.map((message) => message.role) : [];
    expect(texts.filter((role) => role === "user")).toHaveLength(2);
  });
});

describe("deleting a project", () => {
  test("removes its threads, coordinator, memory and files, stops what runs, and keeps the repo", async () => {
    const { s, project } = await setup();
    await s.services.memory.write(project.id, {
      name: "MEMORY.md",
      description: "",
      body: "notes",
    });
    const spawned = await s.services.threads.spawn(project.id, {
      title: "Long job",
      prompt: "long job [fake: delay=30000]",
    });
    if (!spawned.success) throw new Error("thread not spawned");
    await eventually(
      async () =>
        (await s.ctx.chatSessionRepository.getById(spawned.thread.id))?.runtime_session_id ??
        undefined,
      "the CLI to start",
    );

    const removed = await s.services.projects.remove(project.id);

    expect(removed).toEqual({ success: true });
    expect(await s.services.projects.list()).toEqual([]);
    for (const table of [
      "chat_sessions",
      "chat_messages",
      "chat_runs",
      "memory_files",
      "project_repos",
    ] as const) {
      expect(await s.db.selectFrom(table).selectAll().execute()).toEqual([]);
    }
    expect(existsSync(aopPaths.projectDir(project.id))).toBe(false);
    expect(await s.ctx.repoRepository.getById(s.repos[0]?.id ?? "")).not.toBeNull();
    const types = await eventTypes(s);
    expect(types.at(-1)).toBe("project.removed");
    expect(types).toContain("thread.upserted");
  }, 30_000);

  test("an unknown project is not found", async () => {
    const s = await createProjectStack(home.path());
    stack = s;

    expect(await s.services.projects.remove("proj_nope")).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_FOUND" },
    });
  });
});

describe("talking to the coordinator", () => {
  test("a message runs the coordinator and its reply is a wire assistant message", async () => {
    const { s, project } = await setup();

    const sent = await s.services.projects.sendToCoordinator(project.id, "  hello coordinator  ");
    await s.settle();

    expect(sent.success && sent.message).toMatchObject({
      role: "user",
      text: "hello coordinator",
      projectId: project.id,
      threadId: null,
    });
    const listed = await s.services.projects.listMessages(project.id);
    const messages = listed.success ? listed.messages : [];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    const reply = messages[1];
    expect(reply?.role === "assistant" && reply.blocks).toMatchObject([
      { type: "text", text: expect.stringContaining("hello coordinator") },
    ]);
  });

  test("blank text is refused before anything runs", async () => {
    const { s, project } = await setup();

    const sent = await s.services.projects.sendToCoordinator(project.id, "   ");

    expect(sent).toEqual({
      success: false,
      error: { code: "INVALID_MESSAGE", message: "Message text is required" },
    });
    expect(await s.db.selectFrom("chat_runs").select("id").execute()).toEqual([]);
  });
});
