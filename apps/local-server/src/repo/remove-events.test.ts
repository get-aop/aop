import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { purgeRepoChatHistory } from "../chat-session/history-maintenance.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createEventLogRepository } from "../event-log/repository.ts";
import { insertProjectSession, projectSettings } from "../project/test-utils.ts";
import { createSuggestionRepository } from "../suggestion/repository.ts";
import { removeRepo } from "./handlers.ts";

/*
 * The product refuses to detach a repo while one of the project's threads works in it, so a
 * thread on an unattached repo only exists in data that predates that rule. Removing such a repo
 * still deletes the thread, and open project streams must hear of it like any other deletion.
 */
describe("removeRepo tells project streams which threads it deleted", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  const detachedProject = async (id: string, repoId: string, threadIds: string[]) => {
    await ctx.projectRepository.create({ id, ...projectSettings({ name: id, repoIds: [] }) });
    for (const threadId of threadIds) {
      await insertProjectSession(
        db,
        { id: threadId, projectId: id, kind: "thread" },
        { repo_id: repoId },
      );
    }
  };

  const eventsOf = async (projectId: string) =>
    (await createEventLogRepository(db).listAfter(projectId, 0)).map((entry) => ({
      type: entry.type,
      payload: entry.payload,
    }));

  test("every deleted thread of a detached project logs thread.removed", async () => {
    await createTestRepo(db, "repo-1", "/path/to/repo-1");
    await detachedProject("proj_1", "repo-1", ["isess_a", "isess_b"]);

    const result = await removeRepo(ctx, (await ctx.repoRepository.getById("repo-1"))?.path ?? "");

    expect(result).toMatchObject({ success: true, repoId: "repo-1" });
    expect(await db.selectFrom("chat_sessions").select("id").execute()).toEqual([]);
    expect(await eventsOf("proj_1")).toEqual([
      { type: "thread.removed", payload: { threadId: "isess_a" } },
      { type: "thread.removed", payload: { threadId: "isess_b" } },
    ]);
  });

  test("tells only the project each thread belonged to, and leaves other repos' threads alone", async () => {
    await createTestRepo(db, "repo-1", "/path/to/repo-1");
    await createTestRepo(db, "repo-2", "/path/to/repo-2");
    await detachedProject("proj_1", "repo-1", ["isess_a"]);
    await detachedProject("proj_2", "repo-2", ["isess_other"]);

    await removeRepo(ctx, (await ctx.repoRepository.getById("repo-1"))?.path ?? "");

    expect(await eventsOf("proj_1")).toEqual([
      { type: "thread.removed", payload: { threadId: "isess_a" } },
    ]);
    expect(await eventsOf("proj_2")).toEqual([]);
    expect(await db.selectFrom("chat_sessions").select("id").execute()).toEqual([
      { id: "isess_other" },
    ]);
  });

  test("open project streams are told after the commit, and a proposal the thread came from opens again", async () => {
    await createTestRepo(db, "repo-1", "/path/to/repo-1");
    await detachedProject("proj_1", "repo-1", ["isess_a"]);
    await insertProjectSession(db, { id: "isess_coord", projectId: "proj_1", kind: "coordinator" });
    await db
      .insertInto("chat_messages")
      .values({
        id: "msg_1",
        session_id: "isess_coord",
        role: "assistant",
        content: "Try this",
        created_at: "2026-09-30T09:00:00.000Z",
      })
      .execute();
    await createSuggestionRepository(db).recordStarted("msg_1", "sug_1", "isess_a");
    const committed: number[] = [];
    ctx.eventPublisher.subscribe("proj_1", {
      onCommit: () => committed.push(1),
      onDelta: () => undefined,
    });

    await removeRepo(ctx, (await ctx.repoRepository.getById("repo-1"))?.path ?? "");

    expect(committed).toHaveLength(1);
    expect((await eventsOf("proj_1")).map((event) => event.type)).toEqual([
      "thread.removed",
      "message.updated",
    ]);
    expect(await createSuggestionRepository(db).get("msg_1", "sug_1")).toBeNull();
  });

  test("a thread is deleted together with its entry or not at all", async () => {
    await createTestRepo(db, "repo-1", "/path/to/repo-1");
    await detachedProject("proj_1", "repo-1", ["isess_a"]);

    const purged = await purgeRepoChatHistory(ctx, "repo-1", {
      deletion: async (tx, session, remove) => {
        await remove();
        await tx.append({
          type: "thread.removed",
          projectId: "proj_1",
          payload: { threadId: session.id },
        });
        throw new Error("the log is full");
      },
    });

    expect(purged).toMatchObject({ success: false, error: { reason: "stale-preflight" } });
    expect(await db.selectFrom("chat_sessions").select("id").execute()).toEqual([
      { id: "isess_a" },
    ]);
    expect(await eventsOf("proj_1")).toEqual([]);
  });

  test("a plain chat session of the repo goes without an entry", async () => {
    await createTestRepo(db, "repo-1", "/path/to/repo-1");
    await db
      .insertInto("chat_sessions")
      .values({
        id: "chat-1",
        repo_id: "repo-1",
        title: "Plain chat",
        runtime: "codex",
        model: "test-model",
        reasoning_effort: "medium",
      })
      .execute();

    await removeRepo(ctx, (await ctx.repoRepository.getById("repo-1"))?.path ?? "");

    expect(await db.selectFrom("event_log").select("id").execute()).toEqual([]);
  });
});
