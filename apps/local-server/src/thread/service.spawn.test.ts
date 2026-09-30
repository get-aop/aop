import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { aopPaths } from "@aop/infra";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import { spawnAndSettle, useThreadWorld } from "./test-utils.ts";

const { setup } = useThreadWorld();

describe("spawning a thread", () => {
  test("starts a working thread in the project's only repo with the project's thread settings", async () => {
    const { s, project } = await setup({
      settings: {
        threadAccess: "full-access",
        thread: { provider: "claude-code", model: null, effort: "high" },
      },
    });

    const spawned = await s.services.threads.spawn(project.id, {
      title: "Fix cold start",
      prompt: "Fix the cold start regression",
    });

    expect(spawned.success && spawned.thread).toMatchObject({
      title: "Fix cold start",
      status: "working",
      projectId: project.id,
      repoId: s.repos[0]?.id,
      target: { kind: "host" },
      // Model on default: the thread names none. The fake model lists no effort levels, so the
      // "high" the project asks for has nothing to apply to.
      runtime: { provider: "claude-code", model: null, effort: null },
    });
    await s.settle();
    const session = await s.ctx.chatSessionRepository.getById(
      spawned.success ? spawned.thread.id : "",
    );
    expect(session).toMatchObject({
      kind: "thread",
      project_id: project.id,
      repo_id: s.repos[0]?.id,
      runtime_access_mode: "full-access",
    });
    // The thread works in a worktree of its own, not in the repo's checkout.
    expect(session?.workspace_path).toBe(
      realpathSync(
        aopPaths.worktree(s.repos[0]?.id ?? "", spawned.success ? spawned.thread.id : ""),
      ),
    );
  });

  test("its first message is the coordinator's brief, marked as a relay with the person's quote", async () => {
    const { s, project } = await setup();

    const thread = await spawnAndSettle(s, project.id, {
      prompt: "Audit the retry code",
      quote: "  make retries safer  ",
    });

    const [first] = await s.ctx.chatSessionRepository.listMessages(thread.id);
    expect(first).toMatchObject({ role: "user", content: "Audit the retry code" });
    expect(parseMessageOrigin(first?.origin_json ?? null)).toEqual({
      type: "coordinator-relay",
      quote: "make retries safer",
    });
    const messages = await s.services.threads.listMessages(thread.id);
    expect(messages.success && messages.messages[0]).toMatchObject({
      role: "assistant",
      threadId: thread.id,
      blocks: [
        { type: "quote-forwarded", text: "make retries safer" },
        { type: "text", text: "Audit the retry code" },
      ],
    });
  });

  test("the run's system prompt carries the project's instructions, goal and memory, its message only the brief, and it may read the other repos", async () => {
    const { s, project } = await setup({ repos: 2 });
    await s.services.memory.write(project.id, {
      name: "MEMORY.md",
      description: "",
      body: "- Ledger is append-only",
    });

    const thread = await spawnAndSettle(s, project.id, { prompt: "Audit", repoId: s.repos[1]?.id });

    const run = s.runs[0];
    expect(run?.prompt).toBe("Audit");
    expect(run?.appendSystemPrompt).toContain("Keep pull requests small.");
    expect(run?.appendSystemPrompt).toContain("Ship the new checkout");
    expect(run?.appendSystemPrompt).toContain("- Ledger is append-only");
    expect(run?.cwd).toBe(realpathSync(aopPaths.worktree(s.repos[1]?.id ?? "", thread.id)));
    expect(run?.allowedDirectories).toEqual([s.repos[0]?.path ?? ""]);
    expect(run?.isolation).toBe("open");
    expect(run?.accessMode).toBe("full-access");
  });

  test("a project with several repos needs the coordinator to pick one, and only from its own", async () => {
    const { s, project } = await setup({ repos: 2 });

    const ambiguous = await s.services.threads.spawn(project.id, { prompt: "work" });
    const foreign = await s.services.threads.spawn(project.id, {
      prompt: "work",
      repoId: "repo_x",
    });

    expect(ambiguous).toEqual({
      success: false,
      error: { code: "REPO_REQUIRED", repoIds: s.repos.map((repo) => repo.id) },
    });
    expect(foreign).toEqual({
      success: false,
      error: {
        code: "REPO_NOT_IN_PROJECT",
        repoId: "repo_x",
        repoIds: s.repos.map((repo) => repo.id),
      },
    });
    expect(
      await s.db.selectFrom("chat_sessions").select("id").where("kind", "=", "thread").execute(),
    ).toEqual([]);
  });

  test("a registered repo that is not one of the project's is refused too", async () => {
    const { s, project } = await setup({ repos: 2, projectRepos: 1 });

    const spawned = await s.services.threads.spawn(project.id, {
      prompt: "work",
      repoId: s.repos[1]?.id,
    });

    expect(spawned).toMatchObject({ success: false, error: { code: "REPO_NOT_IN_PROJECT" } });
  });

  test("a project with no repos gets repo-less threads in a scratch directory of their own", async () => {
    const { s, project } = await setup({ repos: 0 });

    const thread = await spawnAndSettle(s, project.id, {
      title: "Sketch",
      prompt: "Sketch the API",
    });

    expect(thread.repoId).toBeNull();
    const session = await s.ctx.chatSessionRepository.getById(thread.id);
    expect(session?.workspace_path).toContain(`${project.id}/threads/${thread.id}`);
    expect(existsSync(session?.workspace_path ?? "")).toBe(true);
  });

  test("refuses a blank or oversized prompt and a paused or unknown project", async () => {
    const { s, project } = await setup();

    const blank = await s.services.threads.spawn(project.id, { prompt: "  " });
    const huge = await s.services.threads.spawn(project.id, { prompt: "x".repeat(20_001) });
    const unknown = await s.services.threads.spawn("proj_nope", { prompt: "work" });
    await s.services.projects.transition(project.id, "pause");
    const paused = await s.services.threads.spawn(project.id, { prompt: "work" });

    expect(blank).toMatchObject({ success: false, error: { code: "INVALID_MESSAGE" } });
    expect(huge).toMatchObject({ success: false, error: { code: "INVALID_MESSAGE" } });
    expect(unknown).toEqual({ success: false, error: { code: "PROJECT_NOT_FOUND" } });
    expect(paused).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_ACTIVE", status: "paused" },
    });
  });

  test("the title defaults to the first line of the prompt", async () => {
    const { s, project } = await setup();

    const thread = await spawnAndSettle(s, project.id, {
      prompt: "\n  Fix the login redirect\nMore detail",
    });

    expect(thread.title).toBe("Fix the login redirect");
  });
});
