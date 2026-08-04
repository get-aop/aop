import { afterEach, describe, expect, test } from "bun:test";
import { createCommandContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { decodeMessageContent } from "./message-images.ts";
import { persistFinalizedChatRun } from "./run-finalization.ts";

const databases: Array<Awaited<ReturnType<typeof createTestDb>>> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe("persistFinalizedChatRun", () => {
  test("binds a confirmed runtime id recovered while a run was interrupted", async () => {
    const { db, run } = await setupRun();

    await db.transaction().execute((trx) =>
      persistFinalizedChatRun(
        trx,
        run,
        "Interrupted — applying your next message.",
        null,
        "recovered-thread",
        {
          status: "interrupted",
          interruptionKind: "steer",
          errorMessage: null,
          runtimeSessionState: "confirmed",
        },
        null,
      ),
    );

    const [session, finalized] = await Promise.all([
      db
        .selectFrom("chat_sessions")
        .select("runtime_session_id")
        .where("id", "=", run.session_id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("chat_runs")
        .select(["runtime_session_id", "runtime_session_state", "status"])
        .where("id", "=", run.id)
        .executeTakeFirstOrThrow(),
    ]);
    expect(session.runtime_session_id).toBe("recovered-thread");
    expect(finalized).toEqual({
      runtime_session_id: "recovered-thread",
      runtime_session_state: "confirmed",
      status: "interrupted",
    });
  });

  test("does not bind an unconfirmed preallocated id after failure", async () => {
    const { db, run } = await setupRun({
      runtime: "grok-build",
      runtime_session_id: "allocated-grok-id",
      runtime_session_state: "allocated",
    });

    await db.transaction().execute((trx) =>
      persistFinalizedChatRun(
        trx,
        run,
        "Runtime failed",
        null,
        "allocated-grok-id",
        {
          status: "failed",
          errorMessage: "Runtime failed",
          runtimeSessionState: "allocated",
        },
        null,
      ),
    );

    const session = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", run.session_id)
      .executeTakeFirstOrThrow();
    expect(session.runtime_session_id).toBeNull();
  });

  test("persists structured Markdown artifacts with the assistant message", async () => {
    const { db, run } = await setupRun();
    const artifacts = [{ path: "/tmp/presentation-prep.md", mimeType: "text/markdown" as const }];

    const message = await db
      .transaction()
      .execute((trx) =>
        persistFinalizedChatRun(
          trx,
          run,
          "Your prep is ready.",
          null,
          "runtime-thread",
          { status: "completed", errorMessage: null },
          null,
          artifacts,
        ),
      );

    expect(decodeMessageContent(message?.content ?? "", run.session_id).artifacts).toEqual(
      artifacts,
    );
  });

  test("does not overwrite an existing different session binding on completed runs", async () => {
    const { db, run } = await setupRun();
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "existing-binding" })
      .where("id", "=", run.session_id)
      .execute();

    await db
      .transaction()
      .execute((trx) =>
        persistFinalizedChatRun(
          trx,
          run,
          "Done with a different runtime id.",
          null,
          "discovered-other-id",
          { status: "completed", errorMessage: null },
          null,
        ),
      );

    const [session, finalized] = await Promise.all([
      db
        .selectFrom("chat_sessions")
        .select("runtime_session_id")
        .where("id", "=", run.session_id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("chat_runs")
        .select(["runtime_session_id", "status"])
        .where("id", "=", run.id)
        .executeTakeFirstOrThrow(),
    ]);
    expect(session.runtime_session_id).toBe("existing-binding");
    expect(finalized).toEqual({
      runtime_session_id: "discovered-other-id",
      status: "completed",
    });
  });
});

const setupRun = async (
  overrides: Partial<ChatRun> = {},
): Promise<{ db: Awaited<ReturnType<typeof createTestDb>>; run: ChatRun }> => {
  const db = await createTestDb();
  databases.push(db);
  const ctx = createCommandContext(db);
  const now = new Date().toISOString();
  await ctx.chatSessionRepository.create({
    id: "isess_finalize",
    repo_id: null,
    title: "Finalize",
    named: false,
    runtime: overrides.runtime ?? "codex-cli",
    runtime_configuration_id: null,
    model: "fixture",
    reasoning_effort: "medium",
    runtime_alias: null,
    runtime_session_id: null,
    workspace_path: "/tmp",
    fast_mode: false,
    default_worker_id: null,
    default_workflow_id: null,
    pinned: false,
    settled_override: null,
    settled_at: null,
    created_at: now,
    updated_at: now,
  });
  await db
    .insertInto("chat_messages")
    .values({
      id: "smsg_finalize_user",
      session_id: "isess_finalize",
      role: "user",
      content: "Continue",
      action: null,
      turn_index: 1,
      disposition: "steered",
      created_at: now,
    })
    .execute();
  const run: ChatRun = {
    id: "crun_finalize",
    session_id: "isess_finalize",
    user_message_id: "smsg_finalize_user",
    assistant_message_id: "smsg_finalize_assistant",
    runtime: "codex-cli",
    log_file_path: "/tmp/finalize.jsonl",
    status: "running",
    runtime_session_id: null,
    resume_session_id: null,
    failure_kind: null,
    interruption_kind: null,
    context_strategy: "fresh",
    workspace_path: "/tmp",
    timeout_policy: "default_v1",
    retry_of_run_id: null,
    runtime_session_state: null,
    error_message: null,
    delegation_runs: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await db.insertInto("chat_runs").values(run).execute();
  return { db, run };
};
