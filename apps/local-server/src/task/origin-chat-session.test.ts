import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ChatActionPayload } from "@aop/common";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import {
  linkTasksFromChatAction,
  linkTaskToOriginChatSession,
  notifyOriginChatOfTaskStatus,
  taskIdsFromChatAction,
} from "./origin-chat-session.ts";

describe("origin-chat-session", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
    await createTestRepo(db, "repo_origin", "/tmp/repo-origin");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("extracts task ids from assignment and task cards", () => {
    const assignment: ChatActionPayload = {
      type: "task-assignment",
      label: "Assign",
      sub: "Title",
      meta: "Backlog",
      proposal: {
        taskIds: ["task_aaa", "task_bbb"],
        repoId: "repo_origin",
      },
    };
    expect(taskIdsFromChatAction(assignment)).toEqual(["task_aaa", "task_bbb"]);
    expect(
      taskIdsFromChatAction({
        type: "task",
        id: "task_ccc",
        label: "Started",
        sub: "Title",
        meta: "In Progress",
      }),
    ).toEqual(["task_ccc"]);
  });

  test("extracts task ids from batch routing cards", () => {
    const batch: ChatActionPayload = {
      type: "task-batch-assignment",
      label: "2 tasks created",
      sub: "First +1 more",
      meta: "Backlog",
      proposal: {
        repoId: "repo_origin",
        items: [
          { taskId: "task_batch_a", title: "First" },
          { taskId: "task_batch_b", title: "Second" },
        ],
      },
    };
    expect(taskIdsFromChatAction(batch)).toEqual(["task_batch_a", "task_batch_b"]);
  });

  test("links origin session and posts Done / Blocked notes", async () => {
    await insertTaskRow(
      db,
      "task_origin_1",
      "repo_origin",
      "docs/tasks/demo-feature-abcdef12",
      "WORKING",
    );
    await insertChatSession(db, "isess_origin_1", "repo_origin", "Origin chat");
    await db
      .updateTable("chat_sessions")
      .set({ settled_override: "settled", settled_at: new Date().toISOString() })
      .where("id", "=", "isess_origin_1")
      .execute();

    await linkTaskToOriginChatSession(db, "task_origin_1", "isess_origin_1");
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_existing",
        session_id: "isess_origin_1",
        role: "user",
        content: "Start the task",
        action: null,
        activity: null,
        turn_index: 4,
        created_at: "2026-01-01T00:00:00.000Z",
      })
      .execute();
    const linked = await db
      .selectFrom("tasks")
      .select("origin_chat_session_id")
      .where("id", "=", "task_origin_1")
      .executeTakeFirst();
    expect(linked?.origin_chat_session_id).toBe("isess_origin_1");

    await notifyOriginChatOfTaskStatus(db, "task_origin_1", "DONE", "WORKING");
    const doneMessages = await db
      .selectFrom("chat_messages")
      .selectAll()
      .where("session_id", "=", "isess_origin_1")
      .execute();
    expect(doneMessages).toHaveLength(2);
    const doneMessage = doneMessages.find((message) => message.id !== "smsg_existing");
    expect(doneMessage?.content).toContain("done");
    expect(doneMessage?.action).toContain("task_origin_1");
    expect(doneMessage?.turn_index).toBe(5);
    const awakened = await db
      .selectFrom("chat_sessions")
      .select(["settled_override", "settled_at"])
      .where("id", "=", "isess_origin_1")
      .executeTakeFirstOrThrow();
    expect(awakened).toEqual({ settled_override: null, settled_at: null });

    await notifyOriginChatOfTaskStatus(db, "task_origin_1", "BLOCKED", "WORKING");
    const blockedMessages = await db
      .selectFrom("chat_messages")
      .selectAll()
      .where("session_id", "=", "isess_origin_1")
      .orderBy("created_at", "asc")
      .execute();
    expect(blockedMessages).toHaveLength(3);
    expect(blockedMessages[2]?.content).toContain("blocked");
    expect(blockedMessages[2]?.turn_index).toBe(6);
  });

  test("links from chat actions without overwriting an existing origin", async () => {
    await insertTaskRow(db, "task_origin_2", "repo_origin", "docs/tasks/other-abcdef12", "DRAFT");
    await insertChatSession(db, "isess_first", "repo_origin", "First");
    await insertChatSession(db, "isess_second", "repo_origin", "Second");

    await linkTasksFromChatAction(db, "isess_first", {
      type: "task-assignment",
      label: "Created",
      sub: "Other",
      meta: "Backlog",
      proposal: { taskIds: ["task_origin_2"], repoId: "repo_origin" },
    });
    await linkTasksFromChatAction(db, "isess_second", {
      type: "task-assignment",
      label: "Created",
      sub: "Other",
      meta: "Backlog",
      proposal: { taskIds: ["task_origin_2"], repoId: "repo_origin" },
    });

    const linked = await db
      .selectFrom("tasks")
      .select("origin_chat_session_id")
      .where("id", "=", "task_origin_2")
      .executeTakeFirst();
    expect(linked?.origin_chat_session_id).toBe("isess_first");
  });
});

const insertTaskRow = async (
  db: Kysely<Database>,
  id: string,
  repoId: string,
  changePath: string,
  status: "DRAFT" | "WORKING" | "DONE" | "BLOCKED",
) => {
  const now = new Date().toISOString();
  await db
    .insertInto("tasks")
    .values({
      id,
      repo_id: repoId,
      change_path: changePath,
      branch_name: null,
      worktree_path: null,
      status,
      ready_at: null,
      preferred_workflow: null,
      base_branch: null,
      preferred_provider: null,
      retry_from_step: null,
      resume_input: null,
      archived_at: null,
      handoff_pending_approval: false,
      handoff_requires_approval_override: null,
      origin_chat_session_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
};

const insertChatSession = async (
  db: Kysely<Database>,
  id: string,
  repoId: string,
  title: string,
) => {
  const now = new Date().toISOString();
  await db
    .insertInto("chat_sessions")
    .values({
      id,
      repo_id: repoId,
      title,
      named: false,
      runtime: "claude-code",
      runtime_configuration_id: null,
      model: "claude-opus-4-8",
      reasoning_effort: "medium",
      runtime_alias: null,
      runtime_session_id: null,
      fast_mode: false,
      default_worker_id: null,
      default_workflow_id: null,
      pinned: false,
      settled_override: null,
      settled_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
};
