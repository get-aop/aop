import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatDelegationRun } from "@aop/common";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import {
  deriveDelegationActivity,
  finishDelegationRun,
  listChatDelegations,
  noteDelegationActivity,
  startDelegationRun,
} from "./delegation-runs.ts";
import { persistFinalizedChatRun } from "./run-finalization.ts";
import { type ChatSessionEvent, subscribeChatSession } from "./session-events.ts";
import type { StreamProgressSnapshot } from "./stream-progress.ts";

const databases: Array<Awaited<ReturnType<typeof createTestDb>>> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe("delegation run registry", () => {
  test("start persists an active entry on the host run and publishes it", async () => {
    const { ctx, run, events } = await setup();

    const started = await startDelegationRun(ctx, run, delegationSpec());

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: started.id,
      kind: "delegation",
      label: "Codex",
      runtime: "codex-cli",
      model: "gpt-5.5",
      reasoning: "high",
      status: "active",
      activity: null,
      logFilePath: "/tmp/delegate.jsonl",
    });
    expect(events.at(-1)).toMatchObject({
      type: "delegation-updated",
      sessionId: run.session_id,
      hostRunId: run.id,
      delegation: { id: started.id, status: "active", sessionTitle: "Host session" },
    });
  });

  test("starting background tasks keeps only the five most recent for the session", async () => {
    const { ctx, run } = await setup();
    const startedIds: string[] = [];

    for (let index = 1; index <= 6; index++) {
      const started = await startDelegationRun(
        ctx,
        run,
        delegationSpec({
          kind: "background-task",
          label: `Task ${index}`,
          toolUseId: `tool_${index}`,
          logFilePath: "",
        }),
      );
      startedIds.push(started.id);
    }

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored.map((entry) => entry.id)).toEqual(startedIds.slice(1));
  });

  test("activity notes persist the latest line and publish updates", async () => {
    const { ctx, run, events } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());

    await noteDelegationActivity(ctx, run.id, started.id, "Running bun test");

    const stored = await delegationRunsOf(ctx, run.id);
    const first = stored[0];
    expect(first?.activity).toBe("Running bun test");
    expect(first && first.updatedAt >= first.startedAt).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "delegation-updated",
      delegation: { id: started.id, activity: "Running bun test", status: "active" },
    });
  });

  test("finish sets terminal status, runtime session id, and error", async () => {
    const { ctx, run, events } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());

    await finishDelegationRun(ctx, run.id, started.id, {
      status: "failed",
      runtimeSessionId: "specialist-thread-1",
      error: "provider exploded",
    });

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored[0]).toMatchObject({
      status: "failed",
      runtimeSessionId: "specialist-thread-1",
      error: "provider exploded",
    });
    expect(events.at(-1)).toMatchObject({
      type: "delegation-updated",
      delegation: { id: started.id, status: "failed", error: "provider exploded" },
    });
  });

  test("concurrent activity note cannot resurrect a finished specialist as active", async () => {
    const { ctx, run } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());

    // Overlapping note + finish: lock serializes so terminal status wins.
    await Promise.all([
      noteDelegationActivity(ctx, run.id, started.id, "late progress line"),
      finishDelegationRun(ctx, run.id, started.id, { status: "completed" }),
    ]);

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored[0]?.status).toBe("completed");
  });

  test("writes against a terminal host run cancel leftover active specialists", async () => {
    const { ctx, run } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());
    await ctx.db
      .updateTable("chat_runs")
      .set({ status: "completed" })
      .where("id", "=", run.id)
      .execute();

    await noteDelegationActivity(ctx, run.id, started.id, "stale note after host ended");

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored[0]?.status).toBe("cancelled");
  });

  test("completed finish replaces stale throttled activity with the final log output", async () => {
    const { ctx, run } = await setup();
    const logFilePath = join(tmpdir(), `aop-delegation-final-${crypto.randomUUID()}.jsonl`);
    // Grok-style log: thoughts stream during the run, the answer lands at the end.
    await writeFile(
      logFilePath,
      `${[
        JSON.stringify({ type: "thought", data: "pondering" }),
        JSON.stringify({ type: "result", subtype: "success", result: "GROK_OK" }),
      ].join("\n")}\n`,
    );
    const started = await startDelegationRun(ctx, run, delegationSpec({ logFilePath }));
    await noteDelegationActivity(ctx, run.id, started.id, "Reasoning");

    await finishDelegationRun(ctx, run.id, started.id, { status: "completed" });

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored[0]).toMatchObject({ status: "completed", activity: "GROK_OK" });
    await rm(logFilePath, { force: true });
  });

  test("failed finish keeps the last live activity instead of rewriting it", async () => {
    const { ctx, run } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());
    await noteDelegationActivity(ctx, run.id, started.id, "Running bun test");

    await finishDelegationRun(ctx, run.id, started.id, {
      status: "failed",
      error: "boom",
    });

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored[0]).toMatchObject({ status: "failed", activity: "Running bun test" });
  });

  test("list flattens entries across sessions with host context", async () => {
    const { ctx, db } = await setupDb();
    const first = await addSessionRun(ctx, db, {
      sessionId: "isess_a",
      runId: "crun_a",
      title: "Alpha",
    });
    const second = await addSessionRun(ctx, db, {
      sessionId: "isess_b",
      runId: "crun_b",
      title: "Beta",
    });
    const active = await startDelegationRun(ctx, first, delegationSpec());
    const done = await startDelegationRun(ctx, second, delegationSpec());
    await finishDelegationRun(ctx, second.id, done.id, { status: "completed" });

    const all = await listChatDelegations(ctx);
    expect(all.map((item) => item.id).sort()).toEqual([active.id, done.id].sort());
    const alpha = all.find((item) => item.id === active.id);
    expect(alpha).toMatchObject({
      sessionId: "isess_a",
      sessionTitle: "Alpha",
      hostRunId: "crun_a",
      hostRunStatus: "running",
    });

    const scoped = await listChatDelegations(ctx, "isess_b");
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.id).toBe(done.id);
  });

  test("list treats an active entry under a terminal host run as cancelled", async () => {
    const { ctx, run } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());
    await ctx.db
      .updateTable("chat_runs")
      .set({ status: "interrupted" })
      .where("id", "=", run.id)
      .execute();

    const all = await listChatDelegations(ctx);
    expect(all[0]).toMatchObject({ id: started.id, status: "cancelled" });
  });

  test("host finalization cancels still-active delegations on interruption", async () => {
    const { ctx, run, events } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());

    await ctx.db.transaction().execute((trx) =>
      persistFinalizedChatRun(
        trx,
        run,
        "Interrupted — applying your next message.",
        null,
        null,
        {
          status: "interrupted",
          interruptionKind: "abort",
          errorMessage: null,
        },
        null,
      ),
    );

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored[0]).toMatchObject({ id: started.id, status: "cancelled" });
    expect(
      events.some(
        (event) =>
          event.type === "delegation-updated" &&
          event.delegation.id === started.id &&
          event.delegation.status === "cancelled",
      ),
    ).toBe(true);
  });

  test("host finalization republishes terminal delegations with terminal host state", async () => {
    const { ctx, run, events } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());
    await finishDelegationRun(ctx, run.id, started.id, { status: "completed" });
    const eventsBeforeFinalization = events.length;

    await ctx.db.transaction().execute((trx) =>
      persistFinalizedChatRun(
        trx,
        run,
        "Done",
        null,
        null,
        {
          status: "completed",
          errorMessage: null,
        },
        null,
      ),
    );

    expect(events.slice(eventsBeforeFinalization)).toContainEqual(
      expect.objectContaining({
        type: "delegation-updated",
        delegation: expect.objectContaining({
          id: started.id,
          status: "completed",
          hostRunStatus: "completed",
        }),
      }),
    );
  });

  test("host finalization fails still-active delegations when the turn failed", async () => {
    const { ctx, run } = await setup();
    const started = await startDelegationRun(ctx, run, delegationSpec());

    await ctx.db.transaction().execute((trx) =>
      persistFinalizedChatRun(
        trx,
        run,
        "Runtime failed before producing a final response.",
        null,
        null,
        {
          status: "failed",
          errorMessage: "Runtime failed before producing a final response.",
        },
        null,
      ),
    );

    const stored = await delegationRunsOf(ctx, run.id);
    expect(stored[0]).toMatchObject({ id: started.id, status: "failed" });
  });
});

describe("deriveDelegationActivity", () => {
  test("prefers the currently running command", () => {
    const progress = snapshot({
      commandGroups: [
        {
          id: "g1",
          commands: [
            { id: "c1", command: "bun test", status: "running" },
            { id: "c2", command: "bun build", status: "done" },
          ],
        },
      ],
    });
    expect(deriveDelegationActivity(progress)).toBe("Running bun test");
  });

  test("falls back to the latest answer text line", () => {
    const progress = snapshot({ content: "First line\nSecond line is the activity" });
    expect(deriveDelegationActivity(progress)).toBe("Second line is the activity");
  });

  test("falls back to reasoning when only thoughts stream", () => {
    expect(deriveDelegationActivity(snapshot({ thinking: "hmm" }))).toBe("Reasoning");
  });

  test("returns null when nothing has happened", () => {
    expect(deriveDelegationActivity(snapshot({}))).toBeNull();
  });

  test("truncates long activity lines", () => {
    const progress = snapshot({ content: "x".repeat(200) });
    expect(deriveDelegationActivity(progress)?.length).toBeLessThanOrEqual(80);
  });
});

interface SetupOptions {
  sessionId?: string;
  runId?: string;
  title?: string;
}

const setupDb = async () => {
  const db = await createTestDb();
  databases.push(db);
  return { ctx: createCommandContext(db), db };
};

const setup = async (options: SetupOptions = {}) => {
  const { ctx, db } = await setupDb();
  const run = await addSessionRun(ctx, db, options);
  const events: ChatSessionEvent[] = [];
  const unsubscribe = subscribeChatSession(run.session_id, (event) => events.push(event));
  listeners.push(unsubscribe);
  return { ctx, db, run, events };
};

const addSessionRun = async (
  ctx: LocalServerContext,
  db: Awaited<ReturnType<typeof createTestDb>>,
  options: SetupOptions = {},
): Promise<ChatRun> => {
  const sessionId = options.sessionId ?? "isess_host";
  const runId = options.runId ?? "crun_host";
  const now = new Date().toISOString();
  await ctx.chatSessionRepository.create({
    id: sessionId,
    repo_id: null,
    title: options.title ?? "Host session",
    named: false,
    runtime: "claude-code",
    runtime_configuration_id: null,
    model: "claude-opus-4-8",
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
      id: `${runId}_user`,
      session_id: sessionId,
      role: "user",
      content: "%codex review this",
      action: null,
      turn_index: 1,
      disposition: "immediate",
      created_at: now,
    })
    .execute();
  await db
    .insertInto("chat_runs")
    .values({
      id: runId,
      session_id: sessionId,
      user_message_id: `${runId}_user`,
      assistant_message_id: `${runId}_assistant`,
      runtime: "claude-code",
      log_file_path: "/tmp/host.jsonl",
      status: "running",
      runtime_session_id: null,
      resume_session_id: null,
      failure_kind: null,
      interruption_kind: null,
      context_strategy: "native_resume",
      workspace_path: "/tmp",
      timeout_policy: null,
      retry_of_run_id: null,
      runtime_session_state: null,
      error_message: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return db
    .selectFrom("chat_runs")
    .selectAll()
    .where("id", "=", runId)
    .executeTakeFirstOrThrow() as Promise<ChatRun>;
};

const listeners: Array<() => void> = [];
beforeEach(() => {
  for (const unsubscribe of listeners.splice(0)) unsubscribe();
});

const delegationSpec = (overrides: Record<string, unknown> = {}) => ({
  kind: "delegation" as const,
  label: "Codex",
  runtime: "codex-cli",
  runtimeAlias: null,
  runtimeConfigurationId: null,
  model: "gpt-5.5",
  reasoning: "high",
  fastMode: false,
  logFilePath: "/tmp/delegate.jsonl",
  ...overrides,
});

const delegationRunsOf = async (
  ctx: LocalServerContext,
  runId: string,
): Promise<ChatDelegationRun[]> => {
  const row = await ctx.db
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  const { parseChatDelegationRuns } = await import("@aop/common");
  return parseChatDelegationRuns(row.delegation_runs);
};

const snapshot = (overrides: Partial<StreamProgressSnapshot>): StreamProgressSnapshot => ({
  thinking: "",
  content: "",
  commandGroups: [],
  ...overrides,
});
