import type { LocalServerContext } from "../context.ts";

export const persistActiveRuntimeSession = async (
  ctx: LocalServerContext,
  runId: string,
  runtimeSessionId: string,
): Promise<void> => {
  const now = new Date().toISOString();
  await ctx.db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("chat_runs")
      .selectAll()
      .where("id", "=", runId)
      .executeTakeFirst();
    if (run?.status !== "running") return;
    if (run.runtime_session_id && run.runtime_session_id !== runtimeSessionId) {
      throw new Error(
        `Runtime session invariant violated for ${runId}: ${run.runtime_session_id} != ${runtimeSessionId}`,
      );
    }
    const session = await trx
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", run.session_id)
      .executeTakeFirstOrThrow();
    if (session.runtime_session_id && session.runtime_session_id !== runtimeSessionId) {
      throw new Error(
        `Chat session binding invariant violated for ${run.session_id}: ${session.runtime_session_id} != ${runtimeSessionId}`,
      );
    }
    await trx
      .updateTable("chat_runs")
      .set({
        runtime_session_id: runtimeSessionId,
        runtime_session_state: "confirmed",
        updated_at: now,
      })
      .where("id", "=", runId)
      .where("status", "=", "running")
      .execute();
    await trx
      .updateTable("chat_sessions")
      .set({ runtime_session_id: runtimeSessionId, updated_at: now })
      .where("id", "=", run.session_id)
      .execute();
  });
};

export const allocateFreshRuntimeSession = async (
  ctx: LocalServerContext,
  runId: string,
  runtimeSessionId: string,
): Promise<void> => {
  const now = new Date().toISOString();
  await ctx.db
    .updateTable("chat_runs")
    .set({
      runtime_session_id: runtimeSessionId,
      runtime_session_state: "allocated",
      updated_at: now,
    })
    .where("id", "=", runId)
    .where("status", "=", "running")
    .where("runtime_session_id", "is", null)
    .returning("id")
    .executeTakeFirstOrThrow();
};

export const retireStaleRuntimeSession = async (
  ctx: LocalServerContext,
  runId: string,
  staleRuntimeSessionId: string,
): Promise<void> => {
  const now = new Date().toISOString();
  await ctx.db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom("chat_runs")
      .selectAll()
      .where("id", "=", runId)
      .where("status", "=", "running")
      .executeTakeFirstOrThrow();
    if (run.runtime_session_id !== staleRuntimeSessionId) {
      throw new Error(
        `Cannot retire stale runtime session for ${runId}: expected ${staleRuntimeSessionId}, found ${run.runtime_session_id}`,
      );
    }
    const session = await trx
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", run.session_id)
      .executeTakeFirstOrThrow();
    if (session.runtime_session_id !== staleRuntimeSessionId) {
      throw new Error(
        `Cannot retire stale chat binding for ${run.session_id}: expected ${staleRuntimeSessionId}, found ${session.runtime_session_id}`,
      );
    }

    await trx
      .updateTable("chat_runs")
      .set({
        runtime_session_id: null,
        runtime_session_state: null,
        context_strategy: "aop_history",
        updated_at: now,
      })
      .where("id", "=", runId)
      .where("status", "=", "running")
      .execute();
    await trx
      .updateTable("chat_sessions")
      .set({ runtime_session_id: null, updated_at: now })
      .where("id", "=", run.session_id)
      .execute();
  });
};
