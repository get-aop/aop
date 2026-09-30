import { afterEach, describe, expect, test } from "bun:test";
import { loadProjectRunContext, loadTurnContext } from "./prompt-context.ts";
import {
  createProjectStack,
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
    projectSettings({
      instructions: "Keep pull requests small.",
      repoIds: s.repos.map((repo) => repo.id),
    }),
  );
  if (!created.success) throw new Error("project not created");
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(created.project.id);
  if (!coordinator) throw new Error("no coordinator");
  return { s, project: created.project, coordinator };
};

const insertThread = async (s: ProjectStack, projectId: string, repoId: string | null) => {
  const spawned = await s.services.threads.spawn(projectId, {
    title: "Audit",
    prompt: "Audit",
    ...(repoId ? { repoId } : {}),
  });
  if (!spawned.success) throw new Error("thread not spawned");
  await s.settle();
  const session = await s.ctx.chatSessionRepository.getById(spawned.thread.id);
  if (!session) throw new Error("no thread session");
  return { thread: spawned.thread, session };
};

describe("loadProjectRunContext", () => {
  test("gives the coordinator its brief from the stored project: instructions, goal, repos and memory", async () => {
    const { s, project, coordinator } = await setup();
    await s.services.memory.write(project.id, {
      name: "MEMORY.md",
      description: "",
      body: "- Ledger is append-only",
    });
    await s.services.memory.write(project.id, {
      name: "testing.md",
      description: "How to run the suites",
      body: "bun test",
    });

    const context = await loadProjectRunContext(s.ctx, coordinator);

    expect(context?.systemPrompt).toContain('coordinator of the AOP project "Checkout revamp"');
    expect(context?.systemPrompt).toContain("Keep pull requests small.");
    expect(context?.systemPrompt).toContain("Ship the new checkout");
    expect(context?.systemPrompt).toContain(`- ${s.repos[0]?.id}:`);
    expect(context?.systemPrompt).toContain("- Ledger is append-only");
    expect(context?.systemPrompt).toContain("- testing.md: How to run the suites");
    expect(context?.systemPrompt).not.toContain("bun test");
    expect(context?.readableDirectories).toEqual([]);
  });

  test("gives a thread its own brief and lets it read the project's other repos", async () => {
    const { s, project } = await setup({ repos: 2 });
    const { session } = await insertThread(s, project.id, s.repos[1]?.id ?? null);

    const context = await loadProjectRunContext(s.ctx, session);

    expect(context?.systemPrompt).toContain('thread of the AOP project "Checkout revamp"');
    expect(context?.systemPrompt).toContain(`Your workspace is ${session.workspace_path}`);
    expect(context?.systemPrompt).toContain("Keep pull requests small.");
    expect(context?.readableDirectories).toEqual([s.repos[0]?.path ?? ""]);
  });

  test("reads the project fresh for each turn: an edit to instructions or memory shows at once", async () => {
    const { s, project, coordinator } = await setup();
    const before = await loadProjectRunContext(s.ctx, coordinator);

    await s.services.projects.update(project.id, { instructions: "Always squash-merge." });
    await s.services.memory.write(project.id, {
      name: "MEMORY.md",
      description: "",
      body: "- Deploys go out on Tuesdays",
    });
    const after = await loadProjectRunContext(s.ctx, coordinator);

    expect(before?.systemPrompt).toContain("Keep pull requests small.");
    expect(after?.systemPrompt).toContain("Always squash-merge.");
    expect(after?.systemPrompt).not.toContain("Keep pull requests small.");
    expect(after?.systemPrompt).toContain("- Deploys go out on Tuesdays");
  });

  test("does not read another project's memory", async () => {
    const { s, coordinator } = await setup();
    const other = await s.services.projects.create(projectSettings({ name: "Other" }));
    if (!other.success) throw new Error("project not created");
    await s.services.memory.write(other.project.id, {
      name: "MEMORY.md",
      description: "",
      body: "- the other project's secret",
    });

    const context = await loadProjectRunContext(s.ctx, coordinator);

    expect(context?.systemPrompt).not.toContain("other project's secret");
  });

  test("is null for a plain chat", async () => {
    const { s } = await setup();
    const plain = await s.ctx.chatSessionRepository.create({
      id: "isess_plain",
      repo_id: null,
      title: "Plain",
      runtime: "claude-code",
      runtime_configuration_id: null,
      model: "fake-model",
      reasoning_effort: "medium",
      runtime_alias: null,
      runtime_session_id: null,
      workspace_path: null,
      created_at: "2026-09-30T09:00:00.000Z",
      updated_at: "2026-09-30T09:00:00.000Z",
    });

    expect(await loadProjectRunContext(s.ctx, plain)).toBeNull();
    expect(await loadTurnContext(s.ctx, plain)).toBeUndefined();
  });
});

describe("loadTurnContext", () => {
  test("gives the coordinator the thread list, and a thread nothing", async () => {
    const { s, project, coordinator } = await setup();
    const { thread, session } = await insertThread(s, project.id, null);

    const digest = await loadTurnContext(s.ctx, coordinator);

    expect(digest?.join("\n")).toContain(`- ${thread.id} "Audit"`);
    expect(await loadTurnContext(s.ctx, session)).toEqual([]);
  });
});
