import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Project, ThreadAccess } from "@aop/common";
import { ClaudeCodeProvider, type RunOptions } from "@aop/llm-provider";
import { readLaunches } from "@aop/llm-provider/test-fixtures";
import { createProjectStack, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// A project made from just a name gives its threads full access, and the flags the thread's
// Claude CLI is really launched with say so. Everything from the chat engine down to the spawn is
// real; only the CLI is the fake, and it records the flags each launch received. The coordinator
// of the same project stays on its restricted profile.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async (threadAccess?: ThreadAccess) => {
  const s = await createProjectStack(home.path(), { mcp: true });
  stack = s;
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Checkout",
    repoIds: s.repos.map((repo) => repo.id),
    ...(threadAccess ? { threadAccess } : {}),
  });
  expect(created.status).toBe(201);
  return { s, project: created.body.project };
};

const spawnThread = async (s: ProjectStack, project: Project): Promise<string> => {
  const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt: "work" });
  if (!spawned.success) throw new Error("thread not spawned");
  await s.settle();
  return spawned.thread.id;
};

const runOf = (s: ProjectStack, sessionId: string): RunOptions => {
  const run = s.runs.find((candidate) => candidate.env?.AOP_CHAT_SESSION_ID === sessionId);
  if (!run) throw new Error(`no run for ${sessionId}`);
  return run;
};

/** The flags the fake CLI says its first launch for the session received. */
const launchFlagsOf = async (s: ProjectStack, sessionId: string): Promise<string[]> => {
  const nativeId = (await s.ctx.chatSessionRepository.getById(sessionId))?.runtime_session_id;
  const launches = await readLaunches(join(home.path(), "fake-cli"), "claude", nativeId ?? "");
  return launches[0]?.flags ?? [];
};

describe("a thread's access on a project created from just a name", () => {
  test("is full access: the session, the run and the CLI launch all say so", async () => {
    const { s, project } = await setup();
    expect(project.threadAccess).toBe("full-access");

    const threadId = await spawnThread(s, project);

    expect((await s.ctx.chatSessionRepository.getById(threadId))?.runtime_access_mode).toBe(
      "full-access",
    );
    const run = runOf(s, threadId);
    expect(run.accessMode).toBe("full-access");
    expect(new ClaudeCodeProvider().buildCommand(run)).toContain("--dangerously-skip-permissions");
    const flags = await launchFlagsOf(s, threadId);
    expect(flags).toContain("--dangerously-skip-permissions");
    expect(flags).not.toContain("--permission-mode");
  });

  test("is still the restricted profile for the coordinator of the same project", async () => {
    const { s, project } = await setup();
    const sent = await s.api("POST", `/api/projects/${project.id}/messages`, { text: "hello" });
    expect(sent.status).toBe(201);
    await s.settle();

    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    if (!coordinator) throw new Error("the project should have a coordinator");

    expect(coordinator.runtime_access_mode).toBe("approval-required");
    expect(runOf(s, coordinator.id).accessMode).toBe("approval-required");
    const flags = await launchFlagsOf(s, coordinator.id);
    expect(flags).not.toContain("--dangerously-skip-permissions");
    expect(flags).not.toContain("--permission-mode");
  });

  test("a project that chose Edit files launches its threads with acceptEdits and no permission skip", async () => {
    const { s, project } = await setup("auto-accept-edits");

    const threadId = await spawnThread(s, project);

    expect((await s.ctx.chatSessionRepository.getById(threadId))?.runtime_access_mode).toBe(
      "auto-accept-edits",
    );
    const flags = await launchFlagsOf(s, threadId);
    expect(flags).toContain("--permission-mode");
    expect(flags).not.toContain("--dangerously-skip-permissions");
  });
});
