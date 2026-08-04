import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatControlCommandMarker,
  formatRuntimeDelegationMarker,
  getWorkflowModelOptions,
} from "@aop/common";
import { aopPaths } from "@aop/infra";
import { createProvider, type LLMProvider } from "@aop/llm-provider";
import { Hono as HonoApp } from "hono";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { createChatSessionRoutes } from "./routes.ts";
import { sessionRunPhase } from "./runtime-engine.ts";
import type { ChatSessionServiceDeps } from "./service.ts";
import { shutdownChatSessions, waitForPendingChatReplies } from "./service.ts";

const setupWithCtx = async (
  createProviderFn: () => LLMProvider = () => createProvider("e2e-fixture"),
  deps: Omit<ChatSessionServiceDeps, "createProviderFn"> = {},
) => {
  const db = await createTestDb();
  const ctx = createCommandContext(db);
  const repoPath = join(tmpdir(), `aop-chat-session-${crypto.randomUUID()}`);
  await mkdir(repoPath, { recursive: true });
  await createTestRepo(db, "repo_chat_1", repoPath);

  const app = new HonoApp();
  app.route(
    "/api/chat-sessions",
    createChatSessionRoutes(ctx, {
      createProviderFn,
      ...deps,
    }),
  );
  return { db, app, repoPath, ctx };
};

const setup = async (
  createProviderFn: () => LLMProvider = () => createProvider("e2e-fixture"),
  deps: Omit<ChatSessionServiceDeps, "createProviderFn"> = {},
) => {
  const { db, app, repoPath } = await setupWithCtx(createProviderFn, deps);
  return { db, app, repoPath };
};

const teardown = async (db: Awaited<ReturnType<typeof createTestDb>>) => {
  await waitForPendingChatReplies();
  await db.destroy();
};

/** Write minimal assistant text so exit-0 fixtures are not classified as empty_output. */
const writeFixtureAssistantLog = async (
  logFilePath: string | undefined,
  text = "fixture assistant reply",
): Promise<void> => {
  if (!logFilePath) return;
  await mkdir(join(logFilePath, ".."), { recursive: true });
  await writeFile(
    logFilePath,
    `${JSON.stringify({ type: "result", subtype: "success", result: text })}\n`,
  );
};

const runGit = async (cwd: string, ...args: string[]): Promise<void> => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
};

describe("chat-session routes", () => {
  test("aborts an active conversation", async () => {
    let runCount = 0;
    const provider: LLMProvider = {
      name: "abort-fixture",
      run: async (options) => {
        runCount += 1;
        if (runCount > 1) {
          await writeFixtureAssistantLog(options.logFilePath, "Queued reply");
          return { exitCode: 0 };
        }
        await options.onSpawn?.(99_002);
        await new Promise<void>(() => {});
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Keep working" }),
    });
    for (let attempt = 0; attempt < 50 && runCount === 0; attempt++) await Bun.sleep(10);
    const queued = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Queued follow-up" }),
    });
    expect(queued.status).toBe(201);

    const response = await app.request(`/api/chat-sessions/${session.id}/abort`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      aborted: true,
      disposition: "interrupt_requested",
    });
    await waitForPendingChatReplies();

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: { assistantActive: boolean; messages: Array<{ content: string }> };
    };
    expect(body.session.assistantActive).toBe(false);
    expect(
      body.session.messages.some((message) => message.content === "Conversation stopped."),
    ).toBe(true);
    // Stopping ends the interrupted turn and hands off to the queued message.
    expect(runCount).toBe(2);
    expect(body.session.messages.some((message) => message.content === "Queued reply")).toBe(true);

    const cancelledRuns = await db
      .selectFrom("chat_runs")
      .select("status")
      .where("session_id", "=", session.id)
      .where("status", "=", "cancelled")
      .execute();
    expect(cancelledRuns).toHaveLength(1);

    await teardown(db);
  });

  test("reports when there is no active conversation to abort", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");

    const response = await app.request(`/api/chat-sessions/${session.id}/abort`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aborted: false, disposition: "none" });
    await teardown(db);
  });

  test("graceful shutdown interrupts current-process providers and awaits finalizers", async () => {
    let finishProvider: (() => void) | undefined;
    const providerHold = new Promise<void>((resolve) => {
      finishProvider = resolve;
    });
    let interrupted = false;
    const provider: LLMProvider = {
      name: "shutdown-fixture",
      run: async (options) => {
        await options.onSpawn?.(99_020);
        await providerHold;
        return { exitCode: interrupted ? 143 : 0 };
      },
    };
    const { db, app, ctx } = await setupWithCtx(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Long work" }),
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      await Bun.sleep(10);
      const active = await db
        .selectFrom("chat_runs")
        .select("status")
        .where("session_id", "=", session.id)
        .where("status", "=", "running")
        .executeTakeFirst();
      if (active) break;
    }

    const shutdown = shutdownChatSessions(ctx);
    interrupted = true;
    finishProvider?.();
    await shutdown;

    const runs = await db
      .selectFrom("chat_runs")
      .select("status")
      .where("session_id", "=", session.id)
      .execute();
    expect(runs.every((run) => run.status !== "running")).toBe(true);
    // Database remains usable after chat shutdown (server closes DB afterward).
    await db.selectFrom("chat_sessions").select("id").execute();
    await teardown(db);
  });

  test("send response and detail agree on pending lifecycle after accept", async () => {
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const { db, app } = await setup(
      () => ({
        name: "lifecycle-pending",
        run: async (options) => {
          await writeFixtureAssistantLog(options.logFilePath);
          return { exitCode: 0 };
        },
      }),
      { beforeAssistantReply: async () => hold },
    );
    const session = await createSession(app, "repo_chat_1");

    const send = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Start work" }),
    });
    expect(send.status).toBe(201);
    const sendBody = (await send.json()) as {
      session: { assistantActive: boolean; assistantLifecycle?: string };
    };
    expect(sendBody.session.assistantActive).toBe(true);
    expect(sendBody.session.assistantLifecycle).toBe("pending");

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const detailBody = (await detail.json()) as {
      session: { assistantActive: boolean; assistantLifecycle?: string };
    };
    expect(detailBody.session.assistantActive).toBe(true);
    expect(["pending", "running", "cancelling"]).toContain(
      detailBody.session.assistantLifecycle ?? "",
    );

    const list = await app.request("/api/chat-sessions");
    const listBody = (await list.json()) as {
      sessions: Array<{ id: string; assistantActive: boolean; assistantLifecycle?: string }>;
    };
    const listed = listBody.sessions.find((item) => item.id === session.id);
    expect(listed?.assistantActive).toBe(true);
    expect(listed?.assistantLifecycle).not.toBe("idle");

    releaseHold?.();
    await waitForPendingChatReplies();
    await teardown(db);
  });

  test("abort after durable run insertion but before provider spawn prevents the provider factory", async () => {
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let factoryCalls = 0;
    const provider: LLMProvider = {
      name: "hold-before-spawn",
      run: async () => {
        factoryCalls += 1;
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(
      () => {
        factoryCalls += 1;
        return provider;
      },
      {
        beforeAssistantReply: async () => hold,
      },
    );
    const session = await createSession(app, "repo_chat_1");

    const send = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Start work" }),
    });
    expect(send.status).toBe(201);

    const abort = await app.request(`/api/chat-sessions/${session.id}/abort`, {
      method: "POST",
    });
    expect(abort.status).toBe(200);
    expect(await abort.json()).toEqual({
      aborted: true,
      disposition: "interrupt_requested",
    });
    releaseHold?.();
    await waitForPendingChatReplies();

    expect(factoryCalls).toBe(0);
    const runs = await db
      .selectFrom("chat_runs")
      .select(["status", "interruption_kind"])
      .where("session_id", "=", session.id)
      .execute();
    expect(runs.some((run) => run.status === "cancelled")).toBe(true);
    expect(runs.every((run) => run.status !== "running")).toBe(true);
    await teardown(db);
  });

  test("repeated abort during the pre-spawn gap does not allow hidden provider work", async () => {
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let factoryCalls = 0;
    const { db, app } = await setup(
      () => {
        factoryCalls += 1;
        return {
          name: "repeat-abort",
          run: async () => ({ exitCode: 0 }),
        };
      },
      { beforeAssistantReply: async () => hold },
    );
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Start work" }),
    });
    for (let i = 0; i < 3; i++) {
      const abort = await app.request(`/api/chat-sessions/${session.id}/abort`, {
        method: "POST",
      });
      expect(abort.status).toBe(200);
    }
    releaseHold?.();
    await waitForPendingChatReplies();
    expect(factoryCalls).toBe(0);
    await teardown(db);
  });

  test("reset during the pre-spawn gap prevents the provider factory", async () => {
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let factoryCalls = 0;
    const { db, app } = await setup(
      () => {
        factoryCalls += 1;
        return {
          name: "reset-before-spawn",
          run: async () => ({ exitCode: 0 }),
        };
      },
      { beforeAssistantReply: async () => hold },
    );
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Start work" }),
    });
    const reset = await app.request(`/api/chat-sessions/${session.id}/reset-runtime`, {
      method: "POST",
    });
    expect(reset.status).toBe(200);
    releaseHold?.();
    await waitForPendingChatReplies();
    expect(factoryCalls).toBe(0);
    await teardown(db);
  });

  test("queues during pending provider preparation before a PID exists", async () => {
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let factoryCalls = 0;
    const { db, app } = await setup(
      () => {
        factoryCalls += 1;
        return {
          name: "queue-pending",
          run: async (options) => {
            await writeFixtureAssistantLog(options.logFilePath, `reply-${factoryCalls}`);
            return { exitCode: 0 };
          },
        };
      },
      { beforeAssistantReply: async () => hold },
    );
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "First turn" }),
    });

    const queued = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Follow up", midRunMode: "steer" }),
    });
    expect(queued.status).toBe(201);
    const body = (await queued.json()) as {
      midRun?: string;
      queued?: boolean;
      steered?: boolean;
    };
    expect(body.midRun).toBe("queued");
    expect(body.queued).toBe(true);
    expect(body.steered).toBe(false);
    expect(factoryCalls).toBe(0);

    releaseHold?.();
    await waitForPendingChatReplies();
    expect(factoryCalls).toBe(2);
    await teardown(db);
  });

  test("queues a legacy steer request against a durable-only recovered run", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const now = new Date().toISOString();
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_recovered_user",
        session_id: session.id,
        role: "user",
        content: "Recovered run",
        action: null,
        created_at: now,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_recovered",
        session_id: session.id,
        user_message_id: "smsg_recovered_user",
        assistant_message_id: "smsg_recovered_assistant",
        runtime: "claude-code",
        log_file_path: join(repoPath, "recovered-run.jsonl"),
        status: "running",
        runtime_session_id: "thread_recovered",
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const steer = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Follow up while recovering", midRunMode: "steer" }),
    });
    expect(steer.status).toBe(201);
    const body = (await steer.json()) as { midRun?: string; steered?: boolean; queued?: boolean };
    // No live process handle after restart — configured steer must fall back to queue.
    expect(body.midRun).toBe("queued");
    expect(body.queued).toBe(true);
    expect(body.steered ?? false).toBe(false);
    await teardown(db);
  });

  test("explicit abort stops the current reply and runs the next queued message", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let runCount = 0;
    const provider: LLMProvider = {
      name: "queue-abort",
      run: async (options) => {
        runCount += 1;
        if (runCount === 1) {
          await options.onSpawn?.(99_010);
          await firstHold;
          return { exitCode: 143 };
        }
        await writeFixtureAssistantLog(options.logFilePath, "queued reply after stop");
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "First turn" }),
    });
    for (let attempt = 0; attempt < 50 && runCount === 0; attempt++) await Bun.sleep(10);

    const queued = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Queued follow-up", midRunMode: "queue" }),
    });
    expect(queued.status).toBe(201);

    const abort = await app.request(`/api/chat-sessions/${session.id}/abort`, {
      method: "POST",
    });
    expect(await abort.json()).toEqual({
      aborted: true,
      disposition: "interrupt_requested",
    });
    releaseFirst?.();
    await waitForPendingChatReplies();

    // Stop is a steer: the interrupted turn ends, the queued follow-up still runs.
    expect(runCount).toBe(2);
    const runs = await db
      .selectFrom("chat_runs")
      .innerJoin("chat_messages", "chat_messages.id", "chat_runs.user_message_id")
      .select(["chat_runs.status", "chat_messages.content", "chat_messages.disposition"])
      .where("chat_runs.session_id", "=", session.id)
      .execute();
    const followUp = runs.find((row) => row.content.includes("Queued follow-up"));
    expect(followUp?.status).toBe("completed");
    // The claimed message drops its queued label so the UI stops showing the badge.
    expect(followUp?.disposition).toBe("immediate");
    expect(runs.find((row) => row.content.includes("First turn"))?.status).toBe("cancelled");
    await teardown(db);
  });

  test("stops a durable run left behind by an app restart", async () => {
    let providerCalls = 0;
    const { db, app, repoPath } = await setup(() => ({
      name: "post-recovery-abort-fixture",
      run: async (options) => {
        providerCalls += 1;
        await writeFixtureAssistantLog(options.logFilePath, "Continued after durable cancellation");
        return { exitCode: 0 };
      },
    }));
    const session = await createSession(app, "repo_chat_1");
    const now = new Date().toISOString();

    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_orphaned_user",
        session_id: session.id,
        role: "user",
        content: "Keep watching the release",
        action: null,
        created_at: now,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_orphaned",
        session_id: session.id,
        user_message_id: "smsg_orphaned_user",
        assistant_message_id: "smsg_orphaned_assistant",
        runtime: "codex-cli",
        log_file_path: join(repoPath, "orphaned-run.jsonl"),
        status: "running",
        runtime_session_id: "thread_before_restart",
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const beforeAbort = await app.request(`/api/chat-sessions/${session.id}`);
    const beforeAbortBody = (await beforeAbort.json()) as {
      session: { assistantLifecycle: string };
    };
    expect(beforeAbortBody.session.assistantLifecycle).toBe("uncontrollable");

    const response = await app.request(`/api/chat-sessions/${session.id}/abort`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aborted: true, disposition: "durable_cancelled" });
    const run = await db
      .selectFrom("chat_runs")
      .select("status")
      .where("id", "=", "crun_orphaned")
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("cancelled");

    const next = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Continue with a new turn" }),
    });
    expect(next.status).toBe(201);
    await waitForPendingChatReplies();
    expect(providerCalls).toBe(1);
    expect(
      await db
        .selectFrom("chat_runs")
        .select("status")
        .where("session_id", "=", session.id)
        .orderBy("created_at", "desc")
        .executeTakeFirstOrThrow(),
    ).toEqual({ status: "completed" });

    await teardown(db);
  });

  test("creates a session with the first ordered runtime configuration", async () => {
    const { db, app } = await setup();

    const response = await app.request("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: "repo_chat_1" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      session: {
        title: string;
        runtime: string;
        runtimeConfigurationId: string | null;
        model: string;
        reasoningEffort: string;
        runtimeAlias: string | null;
        named: boolean;
        pinned: boolean;
        settledOverride: "settled" | "active" | null;
        settledAt: string | null;
        lastActivityAt: string | null;
        repoId: string;
      };
    };

    // Built-in seed order starts with Claude Code.
    expect(body.session.title).toBe("New session");
    expect(body.session.runtime).toBe("claude-code");
    expect(body.session.runtimeConfigurationId).toBe("claude-code");
    expect(body.session.model).toBe(getWorkflowModelOptions("claude-code")[0] ?? "");
    expect(body.session.reasoningEffort).toBe("medium");
    expect(body.session.runtimeAlias).toBe("claude");
    expect(body.session.named).toBe(false);
    expect(body.session.pinned).toBe(false);
    expect(body.session.settledOverride).toBeNull();
    expect(body.session.settledAt).toBeNull();
    expect(body.session.lastActivityAt).toBeNull();
    expect(body.session.repoId).toBe("repo_chat_1");

    await teardown(db);
  });

  test("creates a session using the preferred runtime after reordering configuration", async () => {
    const { db, app, ctx } = await setupWithCtx();
    const runtimeConfigurations = createRuntimeConfigurationRepository(ctx.db);
    const providers = await runtimeConfigurations.list();
    const reorderedIds = [
      "grok-build",
      ...providers.map((provider) => provider.id).filter((id) => id !== "grok-build"),
    ];
    await runtimeConfigurations.reorderProviders(reorderedIds);

    const response = await app.request("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: "repo_chat_1" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      session: {
        runtime: string;
        runtimeConfigurationId: string | null;
        model: string;
        reasoningEffort: string;
        runtimeAlias: string | null;
      };
    };

    expect(body.session.runtime).toBe("grok-build");
    expect(body.session.runtimeConfigurationId).toBe("grok-build");
    expect(body.session.model).toBe(getWorkflowModelOptions("grok-build")[0] ?? "");
    expect(body.session.runtimeAlias).toBe("grok");
    expect(["low", "medium", "high", "extra-high", "max"]).toContain(body.session.reasoningEffort);

    await teardown(db);
  });

  test("persists structured runtime actions on the user message", async () => {
    const captured: Parameters<LLMProvider["run"]>[0][] = [];
    const provider: LLMProvider = {
      name: "runtime-actions-fixture",
      run: async (options) => {
        captured.push(options);
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    const actions = [
      {
        id: "review-codex",
        intent: "review",
        runtimeConfigurationId: "codex-cli",
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "high",
        fastMode: false,
        phase: "post-work",
      },
    ];

    const response = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Fix the regression", runtimeActions: actions }),
    });
    expect(response.status).toBe(201);
    await waitForPendingChatReplies();

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: {
        messages: Array<{
          role: string;
          action: { type: string; sub: string; proposal: unknown } | null;
        }>;
      };
    };
    const user = body.session.messages.find((message) => message.role === "user");
    expect(user?.action).toMatchObject({
      type: "runtime-actions",
      sub: "Codex CLI review",
      proposal: {
        actions: [
          {
            id: "review-codex",
            intent: "review",
            runtimeConfigurationId: "codex-cli",
            runtimeConfigurationName: "Codex CLI",
            provider: "codex-cli",
            phase: "post-work",
          },
        ],
      },
    });
    expect(captured).toHaveLength(2);
    expect(captured[0]?.model).toBe("gpt-5.5");
    expect(captured[0]?.prompt).toContain("Fix the regression");
    expect(captured[0]?.prompt).toContain("shared Workflow block 'nuclear_review'");
    expect(captured[0]?.prompt).toContain("You are already the AOP-selected runtime");
    expect(captured[0]?.prompt).toContain("AOP workers are a separate platform concept");
    expect(captured[0]?.prompt).toContain("No writer action was requested");
    expect(captured[0]?.prompt).toContain("Do not implement the original request again");
    expect(captured[0]?.prompt).toContain("Fixed repository baseline:");
    expect(captured[0]?.prompt).toContain("chat-actions");
    expect(captured[0]?.prompt).not.toContain("{{task.docsDir}}");
    expect(captured[1]?.prompt).toContain("The requested Quick Actions have completed");
    expect(captured[1]?.prompt).not.toContain("MAIN RESULT:");
    await teardown(db);
  });

  test("keeps the host runtime session when another runtime implements", async () => {
    const hostSessionId = "11111111-1111-4111-8111-111111111111";
    const specialistSessionId = "22222222-2222-4222-8222-222222222222";
    const captured = [] as Parameters<LLMProvider["run"]>[0][];
    const provider: LLMProvider = {
      name: "cross-runtime-implement-fixture",
      run: async (options) => {
        captured.push(options);
        const isSpecialist = captured.length === 1;
        const runtimeSessionId = isSpecialist ? specialistSessionId : hostSessionId;
        await options.onSession?.(runtimeSessionId);
        await writeFixtureAssistantLog(
          options.logFilePath,
          isSpecialist ? "Implementation complete" : "Consolidated result",
        );
        return { exitCode: 0, sessionId: runtimeSessionId };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({
        runtime: "grok-build",
        runtime_configuration_id: "grok-build",
        model: getWorkflowModelOptions("grok-build")[0] ?? "",
        runtime_session_id: hostSessionId,
      })
      .where("id", "=", session.id)
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Implement the regression fix",
        runtimeActions: [
          {
            id: "implement-claude",
            intent: "implement",
            runtimeConfigurationId: "claude-code",
            provider: "claude-code",
            model: getWorkflowModelOptions("claude-code")[0] ?? "",
            reasoning: "medium",
            fastMode: false,
            phase: "writer",
          },
        ],
      }),
    });
    expect(response.status).toBe(201);
    await waitForPendingChatReplies();

    expect(captured).toHaveLength(2);
    expect(captured[0]?.resumeSessionId).toBeUndefined();
    expect(captured[0]?.prompt).toContain("You are already the AOP-selected runtime");
    expect(captured[0]?.prompt).toContain("AOP workers are a separate platform concept");
    expect(captured[1]?.resumeSessionId).toBe(hostSessionId);
    const storedSession = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(storedSession.runtime_session_id).toBe(hostSessionId);

    await teardown(db);
  });

  test("delegates a Claude control command from another runtime and resumes the orchestrator", async () => {
    const captured = [] as Parameters<LLMProvider["run"]>[0][];
    const provider: LLMProvider = {
      name: "control-fixture",
      run: async (options) => {
        captured.push(options);
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setupWithCtx(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "We already signed in as the finance administrator." }),
    });
    await waitForPendingChatReplies();
    captured.length = 0;
    await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "opencode" }),
    });

    const response = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "$CC_BROWSER_USE[claude-sonnet-4-6;medium] Inspect the billing page",
      }),
    });
    expect(response.status).toBe(201);
    await waitForPendingChatReplies();

    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      reasoningEffort: "medium",
      browserControl: true,
      computerControl: false,
      resumeSessionId: undefined,
    });
    expect(captured[0]?.prompt).toContain("Inspect the billing page");
    expect(captured[0]?.prompt).toContain("We already signed in as the finance administrator.");
    expect(captured[1]).toMatchObject({
      browserControl: false,
      computerControl: false,
      resumeSessionId: undefined,
    });
    expect(captured[1]?.prompt).toContain("Claude control result");

    await teardown(db);
  });

  test("delegates a Codex control command with model/thinking from the control marker", async () => {
    const captured = [] as Parameters<LLMProvider["run"]>[0][];
    const provider: LLMProvider = {
      name: "codex-control-fixture",
      run: async (options) => {
        captured.push(options);
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setupWithCtx(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "pi" }),
    });

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "$CX_COMPUTER_USE[gpt-5.4;extra-high] Open System Settings",
      }),
    });
    await waitForPendingChatReplies();

    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      model: "gpt-5.4",
      reasoningEffort: "extra-high",
      browserControl: false,
      computerControl: true,
      resumeSessionId: undefined,
    });
    expect(captured[1]?.prompt).toContain("Codex control result");

    await teardown(db);
  });

  test("delegates an opted-in runtime request with compact context and resumes the orchestrator", async () => {
    const providerKeys: string[] = [];
    const captured = [] as Parameters<LLMProvider["run"]>[0][];
    const provider: LLMProvider = {
      name: "runtime-delegation-fixture",
      run: async (options) => {
        captured.push(options);
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup((key?: string) => {
      providerKeys.push(key ?? "");
      return provider;
    });
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "The regression is isolated to the billing service." }),
    });
    await waitForPendingChatReplies();
    captured.length = 0;
    providerKeys.length = 0;

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Ask for a second opinion $DELEGATE_OMP" }),
    });
    await waitForPendingChatReplies();

    expect(providerKeys).toEqual(["pi", "claude-code"]);
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({ runtimeAlias: "omp", resumeSessionId: undefined });
    expect(captured[0]?.prompt).toContain("The regression is isolated to the billing service.");
    expect(captured[0]?.prompt).toContain("Ask for a second opinion");
    // New sessions bind the first runtime configuration (Claude → command "claude").
    expect(captured[1]?.runtimeAlias).toBe("claude");
    expect(captured[1]?.prompt).toContain("OMP specialist result");
    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: { messages: Array<{ role: string; content: string }> };
    };
    expect(body.session.messages.at(-2)?.content).toBe("Ask for a second opinion $DELEGATE_OMP");

    await teardown(db);
  });

  test("spawns the delegated specialist with the marker's model and thinking", async () => {
    const captured = [] as Parameters<LLMProvider["run"]>[0][];
    const provider: LLMProvider = {
      name: "delegation-selection-fixture",
      run: async (options) => {
        captured.push(options);
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Fix the flaky test $DELEGATE_CODEX[gpt-5.4;extra-high]",
      }),
    });
    await waitForPendingChatReplies();

    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({ model: "gpt-5.4", reasoningEffort: "extra-high" });
    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: { messages: Array<{ role: string; content: string }> };
    };
    // Transport markers stay on the stored message so the dashboard can render action badges.
    expect(body.session.messages.at(-2)?.content).toBe(
      "Fix the flaky test $DELEGATE_CODEX[gpt-5.4;extra-high]",
    );

    await teardown(db);
  });

  test("spawns a % custom runtime delegation with its configured command and model", async () => {
    const captured = [] as Parameters<LLMProvider["run"]>[0][];
    const provider: LLMProvider = {
      name: "configured-delegation-fixture",
      run: async (options) => {
        captured.push(options);
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: "rtprov_cc_personal",
        name: "CC Personal",
        command: "cpe",
        driver: "claude-code",
        built_in: false,
      })
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: "rtmodel_cc_personal_fable",
        provider_id: "rtprov_cc_personal",
        description: "Fable 5",
        model: "claude-fable-5",
        thinking_levels: JSON.stringify(["low", "medium", "high"]),
        fast_mode: false,
        built_in: false,
        position: 0,
        is_default: true,
        default_thinking_level: "low",
      })
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Send to CC Personal to review those changes ${formatRuntimeDelegationMarker({
          id: "claude",
          model: "claude-fable-5",
          reasoning: "low",
          runtimeConfigurationId: "rtprov_cc_personal",
        })}`,
      }),
    });
    await waitForPendingChatReplies();

    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      runtimeAlias: "cpe",
      model: "claude-fable-5",
      reasoningEffort: "low",
      resumeSessionId: undefined,
    });
    expect(captured[0]?.prompt).toContain("You are already the AOP-selected runtime");
    expect(captured[0]?.prompt).toContain(
      "Treat runtime-selection wording in the request as orchestration metadata",
    );
    expect(captured[0]?.prompt).toContain("AOP workers are a separate platform concept");
    expect(captured[0]?.prompt).toContain("Send to CC Personal to review those changes");

    await teardown(db);
  });

  test("starts a fresh specialist when delegating to the current runtime", async () => {
    const captured = [] as Parameters<LLMProvider["run"]>[0][];
    let runCount = 0;
    const provider: LLMProvider = {
      name: "same-runtime-delegation-fixture",
      run: async (options) => {
        runCount += 1;
        captured.push(options);
        await writeFixtureAssistantLog(options.logFilePath, `reply-${runCount}`);
        return { exitCode: 0, sessionId: runCount === 1 ? "orchestrator-thread" : undefined };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Establish the orchestrator thread" }),
    });
    await waitForPendingChatReplies();
    captured.length = 0;

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Review the approach $DELEGATE_CLAUDE" }),
    });
    await waitForPendingChatReplies();

    expect(captured).toHaveLength(2);
    expect(captured[0]?.resumeSessionId).toBeUndefined();
    expect(captured[1]?.resumeSessionId).toBe("orchestrator-thread");

    await teardown(db);
  });

  test("preallocates and confirms the main Grok session after a delegated handoff", async () => {
    let call = 0;
    let mainSessionId = "";
    const provider: LLMProvider = {
      name: "delegated-grok-handoff",
      run: async (options) => {
        call += 1;
        if (call === 1) {
          await writeFixtureAssistantLog(options.logFilePath, "Specialist result");
          return { exitCode: 0 };
        }
        mainSessionId = options.newSessionId ?? "";
        await options.onSession?.(mainSessionId);
        if (options.logFilePath) {
          await writeFile(
            options.logFilePath,
            [
              JSON.stringify({ type: "text", data: "Handoff complete" }),
              JSON.stringify({ type: "end", stopReason: "EndTurn" }),
            ].join("\n"),
          );
        }
        return { exitCode: 0, sessionId: mainSessionId };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime: "grok-build", model: "grok-4.5", runtime_configuration_id: null })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Investigate the failure $DELEGATE_CLAUDE" }),
    });
    await waitForPendingChatReplies();

    expect(mainSessionId).toMatch(/^[0-9a-f-]{36}$/);
    const [storedSession, run] = await Promise.all([
      db
        .selectFrom("chat_sessions")
        .select("runtime_session_id")
        .where("id", "=", session.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("chat_runs")
        .select(["runtime_session_id", "runtime_session_state"])
        .where("session_id", "=", session.id)
        .executeTakeFirstOrThrow(),
    ]);
    expect(storedSession.runtime_session_id).toBe(mainSessionId);
    expect(run).toEqual({
      runtime_session_id: mainSessionId,
      runtime_session_state: "confirmed",
    });
    await teardown(db);
  });

  test("rejects Claude computer control without launching a detached provider", async () => {
    const captured = [] as Parameters<LLMProvider["run"]>[0][];
    const provider: LLMProvider = {
      name: "native-control-fixture",
      run: async (options) => {
        captured.push(options);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "$CC_COMPUTER_USE Open System Settings" }),
    });
    await waitForPendingChatReplies();

    expect(captured).toHaveLength(0);
    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: { messages: Array<{ role: string; content: string }> };
    };
    expect(body.session.messages.at(-1)?.content).toContain(
      "Claude computer control is not supported in detached sessions",
    );

    await teardown(db);
  });

  test("does not resume the orchestrator after a failed delegated control run", async () => {
    let runCount = 0;
    const prompts: string[] = [];
    const provider: LLMProvider = {
      name: "failed-control-fixture",
      run: async (options) => {
        runCount += 1;
        prompts.push(options.prompt);
        return runCount === 1
          ? { exitCode: 1, sessionId: "foreign-claude-thread" }
          : { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "opencode" }),
    });

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "$CC_BROWSER_USE Inspect billing" }),
    });
    await waitForPendingChatReplies();

    expect(runCount).toBe(2);
    expect(prompts[1]).toContain("control attempt failed");
    expect(prompts[1]).not.toContain("completed the requested work");
    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: { runtimeSessionId: string | null; messages: Array<{ content: string }> };
    };
    expect(body.session.runtimeSessionId).toBeNull();

    await teardown(db);
  });

  test("keeps an interrupted specialist thread id off the orchestrator session", async () => {
    let specialistStarted = false;
    const provider: LLMProvider = {
      name: "interrupted-control-fixture",
      run: async (options) => {
        specialistStarted = true;
        await options.onSpawn?.(99_005);
        await options.onSession?.("foreign-codex-thread");
        await new Promise<void>(() => {});
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "pi" }),
    });
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "$CX_BROWSER_USE Inspect billing" }),
    });
    for (let attempt = 0; attempt < 50 && !specialistStarted; attempt++) await Bun.sleep(10);

    await app.request(`/api/chat-sessions/${session.id}/abort`, { method: "POST" });
    await waitForPendingChatReplies();

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as { session: { runtimeSessionId: string | null } };
    expect(body.session.runtimeSessionId).toBeNull();

    await teardown(db);
  });

  test("publishes progress while the delegated specialist is running", async () => {
    let runCount = 0;
    const provider: LLMProvider = {
      name: "progress-control-fixture",
      run: async (options) => {
        runCount += 1;
        if (runCount === 1 && options.logFilePath) {
          await appendFile(
            options.logFilePath,
            `${JSON.stringify({ type: "text", data: "Inspecting in specialist" })}\n`,
          );
          await Bun.sleep(120);
        }
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "opencode" }),
    });
    const events: string[] = [];
    const { subscribeChatSession } = await import("./session-events.ts");
    const unsubscribe = subscribeChatSession(session.id, (event) => {
      if (event.type === "assistant-progress") events.push(event.content);
    });

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "$CC_BROWSER_USE Inspect billing" }),
    });
    await waitForPendingChatReplies();
    unsubscribe();

    expect(events).toContain("Inspecting in specialist");
    await teardown(db);
  });

  test("creates a general task conversation outside a repository", async () => {
    let cwd: string | undefined;
    const provider: LLMProvider = {
      name: "general-task-fixture",
      run: async (options) => {
        cwd = options.cwd;
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);

    const response = await app.request("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "general" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      session: { id: string; scope: string; repoId: string | null; repoName: string };
    };
    expect(body.session.scope).toBe("general");
    expect(body.session.repoId).toBeNull();
    expect(body.session.repoName).toBe("Tasks");

    const sent = await app.request(`/api/chat-sessions/${body.session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Explain quantum error correction" }),
    });
    expect(sent.status).toBe(201);
    await waitForPendingChatReplies();
    expect(cwd).toBe(aopPaths.generalChatWorkspace());

    await teardown(db);
  });

  test("rejects create with missing scope or an unknown repo", async () => {
    const { db, app } = await setup();

    const missing = await app.request("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const unknown = await app.request("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: "nope" }),
    });
    expect(unknown.status).toBe(404);

    await teardown(db);
  });

  test("lists sessions with repo grouping fields, pin order, and snippet truncation", async () => {
    const { db, app } = await setup();

    const createdA = await createSession(app, "repo_chat_1");
    const createdB = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${createdB.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content:
          "This is a long message that should be truncated in the rail snippet after forty-six characters exactly.",
      }),
    });

    await waitForPendingChatReplies();
    await app.request(`/api/chat-sessions/${createdA.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    const latestMessage = await db
      .selectFrom("chat_messages")
      .select("created_at")
      .where("session_id", "=", createdB.id)
      .orderBy("created_at", "desc")
      .executeTakeFirstOrThrow();

    const list = await app.request("/api/chat-sessions");
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      sessions: Array<{
        id: string;
        pinned: boolean;
        snippet: string | null;
        lastActivityAt: string | null;
        repoName: string;
        repoPath: string;
      }>;
    };

    expect(body.sessions.length).toBeGreaterThanOrEqual(2);
    expect(body.sessions[0]?.id).toBe(createdA.id);
    expect(body.sessions[0]?.pinned).toBe(true);

    const withSnippet = body.sessions.find((s) => s.id === createdB.id);
    expect(withSnippet?.snippet).toBeTruthy();
    expect(withSnippet?.snippet?.length).toBeLessThanOrEqual(46);
    expect(withSnippet?.lastActivityAt).toBe(latestMessage.created_at);
    expect(withSnippet?.repoPath).toBeTruthy();
    expect(withSnippet?.repoName).toBeTruthy();

    const detail = await app.request(`/api/chat-sessions/${createdB.id}`);
    const detailBody = (await detail.json()) as { session: { lastActivityAt: string | null } };
    expect(detailBody.session.lastActivityAt).toBe(latestMessage.created_at);

    await teardown(db);
  });

  test("strips delegation and control transport markers from session snippets", async () => {
    const { db, app } = await setup();
    const delegated = await createSession(app, "repo_chat_1");
    const controlled = await createSession(app, "repo_chat_1");
    const createdAt = new Date().toISOString();

    await db
      .insertInto("chat_messages")
      .values([
        {
          id: "smsg_delegation_snippet",
          session_id: delegated.id,
          role: "user",
          content: `Ask Codex to review this ${formatRuntimeDelegationMarker({
            id: "codex",
            model: "gpt-5.5",
            reasoning: "medium",
            fastMode: true,
          })}`,
          action: null,
          created_at: createdAt,
        },
        {
          id: "smsg_control_snippet",
          session_id: controlled.id,
          role: "user",
          content: `${formatControlCommandMarker({
            id: "CX_BROWSER_USE",
            model: "gpt-5.5",
            reasoning: "medium",
            fastMode: true,
          })} Check the browser`,
          action: null,
          created_at: createdAt,
        },
      ])
      .execute();

    const response = await app.request("/api/chat-sessions");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: Array<{ id: string; snippet: string | null }>;
    };

    expect(body.sessions.find((session) => session.id === delegated.id)?.snippet).toBe(
      "Ask Codex to review this",
    );
    expect(body.sessions.find((session) => session.id === controlled.id)?.snippet).toBe(
      "Check the browser",
    );

    await teardown(db);
  });

  test("marks sessions with a running reply as active in the session list", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const now = new Date().toISOString();

    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_list_active_user",
        session_id: session.id,
        role: "user",
        content: "Keep working",
        action: null,
        created_at: now,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_list_active",
        session_id: session.id,
        user_message_id: "smsg_list_active_user",
        assistant_message_id: "smsg_list_active_assistant",
        runtime: "codex-cli",
        log_file_path: join(repoPath, "list-active.jsonl"),
        status: "running",
        runtime_session_id: null,
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const response = await app.request("/api/chat-sessions");
    const body = (await response.json()) as {
      sessions: Array<{ id: string; assistantActive?: boolean }>;
    };

    expect(body.sessions.find((item) => item.id === session.id)?.assistantActive).toBe(true);
    await db
      .updateTable("chat_runs")
      .set({ status: "cancelled", updated_at: new Date().toISOString() })
      .where("id", "=", "crun_list_active")
      .execute();
    await teardown(db);
  });

  test("returns persisted assistant activity in session history", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const activity = {
      thinking: "Inspecting the lifecycle",
      content: "Partial answer",
      commandGroups: [
        {
          id: "group-1",
          commands: [{ id: "command-1", command: "rg session", status: "done" as const }],
        },
      ],
    };
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_activity",
        session_id: session.id,
        role: "assistant",
        content: activity.content,
        action: null,
        activity: JSON.stringify(activity),
        created_at: new Date().toISOString(),
      })
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await response.json()) as {
      session: { messages: Array<{ id: string; activity?: typeof activity }> };
    };

    expect(
      body.session.messages.find((message) => message.id === "smsg_activity")?.activity,
    ).toEqual(activity);
    await teardown(db);
  });

  test("terminalizes command activity when the conversation completes", async () => {
    const provider: LLMProvider = {
      name: "terminal-activity-fixture",
      run: async (options) => {
        if (!options.logFilePath) return { exitCode: 0 };
        await mkdir(join(options.logFilePath, ".."), { recursive: true });
        await writeFile(
          options.logFilePath,
          `${JSON.stringify({
            type: "item.started",
            item: {
              id: "command-without-completion",
              type: "command_execution",
              command: "/bin/zsh -lc 'git status --short'",
              status: "in_progress",
            },
          })}\n`,
        );
        await Bun.sleep(60);
        await appendFile(
          options.logFilePath,
          `${JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: "Done." },
          })}\n`,
        );
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Check the worktree" }),
    });
    await waitForPendingChatReplies();

    const response = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await response.json()) as {
      session: {
        messages: Array<{
          role: string;
          activity?: {
            commandGroups: Array<{
              commands: Array<{
                id: string;
                command: string;
                status: "running" | "done" | "failed";
                exitCode?: number | null;
              }>;
            }>;
          } | null;
        }>;
      };
    };
    const assistant = body.session.messages.find((message) => message.role === "assistant");
    const commands = assistant?.activity?.commandGroups.flatMap((group) => group.commands) ?? [];

    expect(commands).toEqual([
      {
        id: "command-without-completion",
        command: "git status --short",
        status: "done",
        exitCode: 0,
      },
    ]);
    await teardown(db);
  });

  test("gets a session with messages", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello runtime" }),
    });

    const response = await app.request(`/api/chat-sessions/${session.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      session: { id: string; messages: Array<{ role: string; content: string }> };
    };

    expect(body.session.id).toBe(session.id);
    expect(body.session.messages.length).toBeGreaterThanOrEqual(1);
    expect(body.session.messages[0]?.role).toBe("user");
    expect(body.session.messages[0]?.content).toBe("hello runtime");

    await teardown(db);
  });

  test("returns runtime-created Markdown files as assistant artifacts", async () => {
    const provider: LLMProvider = {
      name: "artifact-fixture",
      run: async (options) => {
        if (!options.cwd) throw new Error("expected runtime cwd");
        await writeFile(join(options.cwd, "presentation-prep.md"), "# Presentation");
        await writeFixtureAssistantLog(options.logFilePath, "Your prep is ready.");
        return { exitCode: 0 };
      },
    };
    const { db, app, repoPath } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Prepare my presentation" }),
    });
    await waitForPendingChatReplies();

    const response = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await response.json()) as {
      session: {
        messages: Array<{
          role: string;
          content: string;
          artifacts?: Array<{ path: string; mimeType: string }>;
        }>;
      };
    };
    const assistant = body.session.messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("Your prep is ready.");
    expect(assistant?.artifacts).toEqual([
      { path: join(await realpath(repoPath), "presentation-prep.md"), mimeType: "text/markdown" },
    ]);

    await teardown(db);
  });

  test("lists the authoritative branch for each session workspace", async () => {
    const { db, app, repoPath } = await setup();
    await runGit(repoPath, "init", "-b", "main");
    const session = await createSession(app, "repo_chat_1");
    await runGit(repoPath, "switch", "-c", "feature/listed-branch");

    const response = await app.request("/api/chat-sessions");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: Array<{ id: string; branch?: string | null }>;
    };
    expect(body.sessions.find((item) => item.id === session.id)?.branch).toBe(
      "feature/listed-branch",
    );

    await teardown(db);
  });

  test("reports the session worktree and observes external branch changes", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await runGit(repoPath, "init", "-b", "main");

    const initial = await app.request(`/api/chat-sessions/${session.id}/location`);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      worktreePath: await realpath(repoPath),
      branch: "main",
    });

    await runGit(repoPath, "switch", "-c", "feature/session-location");
    const updated = await app.request(`/api/chat-sessions/${session.id}/location`);
    expect(await updated.json()).toEqual({
      worktreePath: await realpath(repoPath),
      branch: "feature/session-location",
    });

    await teardown(db);
  });

  test("binds and resets a validated session workspace", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const worktreePath = `${repoPath}-bound`;
    await runGit(repoPath, "worktree", "add", "-b", "bound-worktree", worktreePath);

    const bound = await app.request(`/api/chat-sessions/${session.id}/workspace`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: worktreePath }),
    });
    expect(bound.status).toBe(200);
    expect(
      ((await bound.json()) as { session: { workspacePath: string } }).session.workspacePath,
    ).toBe(await realpath(worktreePath));

    const reset = await app.request(`/api/chat-sessions/${session.id}/workspace`, {
      method: "DELETE",
    });
    expect(reset.status).toBe(200);
    expect(
      ((await reset.json()) as { session: { workspacePath: string } }).session.workspacePath,
    ).toBe(await realpath(repoPath));
    await teardown(db);
  });

  test("returns an actionable error when a bound workspace was deleted", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const worktreePath = `${repoPath}-deleted`;
    await runGit(repoPath, "worktree", "add", "-b", "deleted-worktree", worktreePath);
    const canonicalWorktreePath = await realpath(worktreePath);
    await app.request(`/api/chat-sessions/${session.id}/workspace`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: worktreePath }),
    });
    await runGit(repoPath, "worktree", "remove", "--force", worktreePath);

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    expect(detail.status).toBe(409);
    expect(await detail.json()).toEqual({
      code: "WORKSPACE_BINDING_ERROR",
      error: `Bound chat workspace does not exist: ${canonicalWorktreePath}`,
      path: canonicalWorktreePath,
      resettable: true,
    });

    const reset = await app.request(`/api/chat-sessions/${session.id}/workspace`, {
      method: "DELETE",
    });
    expect(reset.status).toBe(200);
    await teardown(db);
  });

  test("recovers one completed assistant reply after a server reload", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const userMessageId = "smsg_recovery_user";
    const assistantMessageId = "smsg_recovery_assistant";
    const logFilePath = join(repoPath, "recovery.jsonl");

    await db
      .insertInto("chat_messages")
      .values({
        id: userMessageId,
        session_id: session.id,
        role: "user",
        content: "Fix the session row",
        action: null,
        created_at: new Date().toISOString(),
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_recovery",
        session_id: session.id,
        user_message_id: userMessageId,
        assistant_message_id: assistantMessageId,
        runtime: "grok-build",
        log_file_path: logFilePath,
        status: "running",
        runtime_session_id: "grok-session",
        runtime_session_state: "allocated",
        error_message: null,
      })
      .execute();
    await writeFile(logFilePath, `${JSON.stringify({ type: "text", data: "Recovered answer" })}\n`);

    const initial = await app.request(`/api/chat-sessions/${session.id}`);
    const initialBody = (await initial.json()) as { session: { assistantActive: boolean } };
    expect(initialBody.session.assistantActive).toBe(true);

    await appendFile(
      logFilePath,
      `${JSON.stringify({ type: "end", stopReason: "EndTurn", sessionId: "grok-session" })}\n`,
    );
    await Promise.all([
      app.request(`/api/chat-sessions/${session.id}`),
      app.request(`/api/chat-sessions/${session.id}`),
    ]);
    await waitForRecoveredRun(db, "crun_recovery");

    const final = await app.request(`/api/chat-sessions/${session.id}`);
    const finalBody = (await final.json()) as {
      session: {
        assistantActive: boolean;
        runtimeSessionId: string | null;
        messages: Array<{ id: string; role: string; content: string }>;
      };
    };
    const assistants = finalBody.session.messages.filter((message) => message.role === "assistant");
    expect(assistants).toEqual([
      expect.objectContaining({ id: assistantMessageId, content: "Recovered answer" }),
    ]);
    expect(finalBody.session.assistantActive).toBe(false);
    expect(finalBody.session.runtimeSessionId).toBe("grok-session");
    expect(
      await db
        .selectFrom("chat_runs")
        .select("runtime_session_state")
        .where("id", "=", "crun_recovery")
        .executeTakeFirstOrThrow(),
    ).toEqual({ runtime_session_state: "confirmed" });

    await teardown(db);
  });

  test("queues a mid-run message while a durable run is still active (queue mode)", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const now = new Date().toISOString();

    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_active_run_user",
        session_id: session.id,
        role: "user",
        content: "Continue working",
        action: null,
        created_at: now,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_active_run",
        session_id: session.id,
        user_message_id: "smsg_active_run_user",
        assistant_message_id: "smsg_active_run_assistant",
        runtime: "grok-build",
        log_file_path: join(repoPath, "still-running.jsonl"),
        status: "running",
        runtime_session_id: null,
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Also fix the tests" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      midRun?: string;
      queued?: boolean;
      message: { role: string; content: string; disposition?: string };
    };
    expect(body.midRun).toBe("queued");
    expect(body.queued).toBe(true);
    expect(body.message).toEqual(
      expect.objectContaining({
        role: "user",
        content: "Also fix the tests",
        disposition: "queued",
      }),
    );

    // Queued message is stored without a chat_run until the active run finishes.
    const runs = await db
      .selectFrom("chat_runs")
      .select(["id", "user_message_id", "status"])
      .where("session_id", "=", session.id)
      .execute();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe("crun_active_run");

    const userMessages = await db
      .selectFrom("chat_messages")
      .select(["content", "role", "disposition"])
      .where("session_id", "=", session.id)
      .where("role", "=", "user")
      .execute();
    expect(userMessages.map((m) => m.content)).toContain("Also fix the tests");
    expect(
      userMessages.find((message) => message.content === "Also fix the tests")?.disposition,
    ).toBe("queued");

    await teardown(db);
  });

  test("drains a queued message after the active reply finishes (queue mode)", async () => {
    let runCount = 0;
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const writeAssistantLog = async (logFilePath: string | undefined, text: string) => {
      if (!logFilePath) return;
      await mkdir(join(logFilePath, ".."), { recursive: true }).catch(() => undefined);
      await writeFile(
        logFilePath,
        `${JSON.stringify({ type: "result", subtype: "success", result: text })}\n`,
      );
    };

    const gatedProvider: LLMProvider = {
      name: "gated-queue",
      run: async (options) => {
        runCount += 1;
        if (runCount === 1) {
          await firstGate;
          await writeAssistantLog(options.logFilePath, "first-reply");
          return { exitCode: 0 };
        }
        await writeAssistantLog(options.logFilePath, "queued-reply");
        return { exitCode: 0 };
      },
    };

    const { db, app } = await setup(() => gatedProvider);
    const session = await createSession(app, "repo_chat_1");

    const first = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Start work" }),
    });
    expect(first.status).toBe(201);

    for (let i = 0; i < 50 && runCount < 1; i++) {
      await Bun.sleep(10);
    }
    expect(runCount).toBe(1);

    const queued = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Also run the tests" }),
    });
    expect(queued.status).toBe(201);
    const queuedBody = (await queued.json()) as { midRun?: string; queued?: boolean };
    expect(queuedBody.midRun).toBe("queued");
    expect(queuedBody.queued).toBe(true);

    releaseFirst?.();
    await waitForPendingChatReplies();

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const detailBody = (await detail.json()) as {
      session: { messages: Array<{ role: string; content: string }> };
    };
    const contents = detailBody.session.messages.map((m) => m.content);
    expect(contents).toEqual(
      expect.arrayContaining([
        "Start work",
        "Also run the tests",
        expect.stringContaining("first-reply"),
        expect.stringContaining("queued-reply"),
      ]),
    );
    expect(runCount).toBe(2);

    await teardown(db);
  });

  test("owns a queued turn before claiming its durable run", async () => {
    let runCount = 0;
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let releaseClaim: (() => void) | undefined;
    const claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    let markClaimEntered: (() => void) | undefined;
    const claimEntered = new Promise<void>((resolve) => {
      markClaimEntered = resolve;
    });
    const provider: LLMProvider = {
      name: "queued-ownership",
      run: async (options) => {
        runCount += 1;
        if (runCount === 1) await firstGate;
        await writeFixtureAssistantLog(options.logFilePath, `reply-${runCount}`);
        return { exitCode: 0 };
      },
    };
    const deps = {
      beforeQueuedRunClaim: async () => {
        markClaimEntered?.();
        await claimGate;
      },
    };
    const { db, app } = await setup(() => provider, deps);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Start work" }),
    });
    while (runCount === 0) await Bun.sleep(10);
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Queued follow-up" }),
    });

    releaseFirst?.();
    await Promise.race([
      claimEntered,
      Bun.sleep(500).then(() => {
        throw new Error("queued claim hook was not reached");
      }),
    ]);
    expect(sessionRunPhase(session.id)).toBe("pending");

    const abort = await app.request(`/api/chat-sessions/${session.id}/abort`, { method: "POST" });
    expect(await abort.json()).toEqual({
      aborted: true,
      disposition: "interrupt_requested",
    });
    releaseClaim?.();
    await waitForPendingChatReplies();

    expect(runCount).toBe(1);
    const runs = await db
      .selectFrom("chat_runs")
      .select("status")
      .where("session_id", "=", session.id)
      .execute();
    expect(runs.every((run) => run.status !== "running")).toBe(true);

    const next = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Start again after abort" }),
    });
    expect(next.status).toBe(201);
    await waitForPendingChatReplies();
    expect(runCount).toBe(2);
    await teardown(db);
  });

  test("keeps later queued turns out of the prompt for the turn claimed before them", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const prompts: string[] = [];
    const provider: LLMProvider = {
      name: "ordered-queue",
      run: async (options) => {
        prompts.push(options.prompt);
        if (prompts.length === 1) await firstGate;
        await writeFixtureAssistantLog(options.logFilePath, `reply-${prompts.length}`);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Turn A" }),
    });
    while (prompts.length === 0) await Bun.sleep(5);
    for (const content of ["Turn B", "Turn C"]) {
      await app.request(`/api/chat-sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    }

    releaseFirst?.();
    await waitForPendingChatReplies();

    expect(prompts[1]?.match(/Turn B/g)).toHaveLength(1);
    expect(prompts[1]).not.toContain("Turn C");
    expect(prompts[2]?.match(/Turn C/g)).toHaveLength(1);
    await teardown(db);
  });

  test.each([
    ["ignores a saved legacy steer mode", "steer", null],
    ["ignores an explicit legacy steer override", "queue", "steer"],
  ] satisfies Array<
    [string, "queue" | "steer", "steer" | null]
  >)("%s", async (_name, savedMode, midRunMode) => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let runCount = 0;
    const gatedProvider: LLMProvider = {
      name: "gated-queue-mode",
      run: async (options) => {
        runCount += 1;
        if (runCount === 1) {
          await options.onSpawn?.(99_001);
          await firstGate;
        }
        await writeFixtureAssistantLog(options.logFilePath, `reply-${runCount}`);
        return { exitCode: 0 };
      },
    };

    const { db, app, ctx } = await setupWithCtx(() => gatedProvider);
    await ctx.settingsRepository.set("chat_mid_run_mode", savedMode);
    const session = await createSession(app, "repo_chat_1");

    const first = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Start work" }),
    });
    expect(first.status).toBe(201);

    for (let i = 0; i < 50 && runCount < 1; i++) await Bun.sleep(10);
    expect(runCount).toBe(1);

    const queued = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Do this next",
        ...(midRunMode ? { midRunMode } : {}),
      }),
    });
    expect(queued.status).toBe(201);
    expect(await queued.json()).toMatchObject({
      midRun: "queued",
      queued: true,
      steered: false,
    });
    expect(runCount).toBe(1);

    releaseFirst?.();
    await waitForPendingChatReplies();
    expect(runCount).toBe(2);

    const runs = await db
      .selectFrom("chat_runs")
      .select(["status", "interruption_kind"])
      .where("session_id", "=", session.id)
      .orderBy("created_at")
      .execute();
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ status: "completed", interruption_kind: null });
    expect(runs[1]).toMatchObject({ status: "completed", interruption_kind: null });

    await teardown(db);
  });

  test.each([
    [
      "opencode",
      [
        { type: "text", part: { text: "continued" } },
        { type: "step_finish", part: { reason: "stop" } },
      ],
    ],
    [
      "pi",
      [
        {
          provider: "pi",
          type: "agent_end",
          messages: [{ role: "assistant", content: [{ type: "text", text: "continued" }] }],
        },
      ],
    ],
  ])("preserves AOP history for queued %s follow-ups", async (runtime, terminalEvents) => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let runCount = 0;
    const prompts: string[] = [];
    const provider: LLMProvider = {
      name: `${runtime}-continuity-fixture`,
      run: async (options) => {
        runCount += 1;
        prompts.push(options.prompt);
        if (runCount === 1) {
          await options.onSpawn?.(99_003);
          await firstGate;
        }
        if (options.logFilePath) {
          await writeFile(
            options.logFilePath,
            `${terminalEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
          );
        }
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime, model: "fixture-model", runtime_configuration_id: null })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Inspect the provider-neutral task" }),
    });
    for (let attempt = 0; attempt < 50 && runCount === 0; attempt++) await Bun.sleep(10);
    const queued = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Continue after the first reply", midRunMode: "steer" }),
    });
    expect(await queued.json()).toMatchObject({ midRun: "queued", queued: true, steered: false });
    expect(runCount).toBe(1);

    releaseFirst?.();
    await waitForPendingChatReplies();

    const runs = await db
      .selectFrom("chat_runs")
      .select(["status", "interruption_kind", "context_strategy"])
      .where("session_id", "=", session.id)
      .orderBy("created_at")
      .execute();
    expect(runs[0]).toMatchObject({ status: "completed", interruption_kind: null });
    expect(runs[1]?.context_strategy).toBe("aop_history");
    expect(prompts[1]).toContain("Inspect the provider-neutral task");
    expect(prompts[1]?.match(/Continue after the first reply/g)).toHaveLength(1);
    await teardown(db);
  });

  test("bootstraps an unbound follow-up from bounded AOP history", async () => {
    const prompts: string[] = [];
    const provider: LLMProvider = {
      name: "history-fixture",
      run: async (options) => {
        prompts.push(options.prompt);
        if (options.logFilePath) {
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({ type: "result", subtype: "success", result: "Done" })}\n`,
          );
        }
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Implement the second task" }),
    });
    await waitForPendingChatReplies();
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Create a PR after it is done" }),
    });
    await waitForPendingChatReplies();

    expect(prompts[1]).toContain("<aop_conversation_context>");
    expect(prompts[1]).toContain("Implement the second task");
    expect(prompts[1]?.match(/Create a PR after it is done/g)).toHaveLength(1);
    const runs = await db
      .selectFrom("chat_runs")
      .select("context_strategy")
      .where("session_id", "=", session.id)
      .orderBy("created_at")
      .execute();
    expect(runs.map((run) => run.context_strategy)).toEqual(["fresh", "aop_history"]);
    await teardown(db);
  });

  test("does not execute a plain delegation marker from conversation history", async () => {
    const prompts: string[] = [];
    const provider: LLMProvider = {
      name: "historical-marker-fixture",
      run: async (options) => {
        prompts.push(options.prompt);
        await writeFixtureAssistantLog(options.logFilePath, "Done");
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Review this $DELEGATE_GROK" }),
    });
    await waitForPendingChatReplies();
    prompts.length = 0;

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Summarize the current status" }),
    });
    await waitForPendingChatReplies();

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Summarize the current status");
    await teardown(db);
  });

  test("rebuilds AOP history before replacing a stale Codex thread", async () => {
    const prompts: string[] = [];
    const resumeIds: Array<string | undefined> = [];
    const provider: LLMProvider = {
      name: "stale-codex-fixture",
      run: async (options) => {
        prompts.push(options.prompt);
        resumeIds.push(options.resumeSessionId);
        if (options.resumeSessionId) {
          await writeFile(
            options.logFilePath ?? "",
            `${JSON.stringify({
              type: "turn.failed",
              error: { message: "no rollout found for thread id stale-thread" },
            })}\n`,
          );
          return { exitCode: 1 };
        }
        await options.onSession?.("fresh-thread");
        if (options.logFilePath) {
          await writeFile(
            options.logFilePath,
            [
              JSON.stringify({ type: "thread.started", thread_id: "fresh-thread" }),
              JSON.stringify({
                type: "turn.completed",
                "last-assistant-message": "Recovered",
              }),
            ].join("\n"),
          );
        }
        return { exitCode: 0, sessionId: "fresh-thread" };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    const now = new Date(Date.now() - 1_000).toISOString();
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_stale_history",
        session_id: session.id,
        role: "user",
        content: "Implement the continuity fix",
        action: null,
        created_at: now,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_stale_history",
        session_id: session.id,
        user_message_id: "smsg_stale_history",
        assistant_message_id: "smsg_stale_history_assistant",
        runtime: "codex-cli",
        log_file_path: join(tmpdir(), "stale-history.jsonl"),
        status: "completed",
        runtime_session_id: "stale-thread",
        resume_session_id: null,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: "fresh",
        workspace_path: null,
        timeout_policy: null,
        retry_of_run_id: null,
        runtime_session_state: "confirmed",
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .updateTable("chat_sessions")
      .set({
        runtime: "codex-cli",
        model: "gpt-5.4",
        runtime_configuration_id: null,
        runtime_session_id: "stale-thread",
      })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Create the PR after you finish" }),
    });
    await waitForPendingChatReplies();

    expect(resumeIds).toEqual(["stale-thread", undefined]);
    expect(prompts[1]).toContain("Implement the continuity fix");
    expect(prompts[1]?.match(/Create the PR after you finish/g)).toHaveLength(1);
    const [updatedSession, run] = await Promise.all([
      db
        .selectFrom("chat_sessions")
        .select("runtime_session_id")
        .where("id", "=", session.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("chat_runs")
        .select(["runtime_session_id", "runtime_session_state", "context_strategy"])
        .where("session_id", "=", session.id)
        .where("id", "!=", "crun_stale_history")
        .executeTakeFirstOrThrow(),
    ]);
    expect(updatedSession.runtime_session_id).toBe("fresh-thread");
    expect(run).toMatchObject({
      runtime_session_id: "fresh-thread",
      runtime_session_state: "confirmed",
      context_strategy: "aop_history",
    });
    await teardown(db);
  });

  test("preallocates and confirms a fresh Grok session before terminal output", async () => {
    let capturedId = "";
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        capturedId = options.newSessionId ?? "";
        if (options.logFilePath) {
          await writeFile(
            options.logFilePath,
            [
              JSON.stringify({ type: "thought", data: "working" }),
              JSON.stringify({ type: "text", data: "Done" }),
              JSON.stringify({ type: "end", session_id: capturedId, stopReason: "EndTurn" }),
            ].join("\n"),
          );
        }
        return { exitCode: 0, sessionId: capturedId };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime: "grok-build", model: "grok-4.5", runtime_configuration_id: null })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    await waitForPendingChatReplies();

    expect(capturedId).toMatch(/^[0-9a-f-]{36}$/);
    const run = await db
      .selectFrom("chat_runs")
      .select(["runtime_session_id", "runtime_session_state", "timeout_policy"])
      .where("session_id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(run).toEqual({
      runtime_session_id: capturedId,
      runtime_session_state: "confirmed",
      timeout_policy: "grok_slow_start_v1",
    });
    await teardown(db);
  });

  test("queues during an active Grok tool without interrupt confirmation", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let runCount = 0;
    let allocatedId = "";
    const prompts: string[] = [];
    const resumeIds: Array<string | undefined> = [];
    const provider: LLMProvider = {
      name: "grok-queue-continuity",
      run: async (options) => {
        runCount += 1;
        prompts.push(options.prompt);
        resumeIds.push(options.resumeSessionId);
        const sessionId = options.resumeSessionId ?? options.newSessionId ?? "";
        if (runCount === 1) {
          allocatedId = sessionId;
          await options.onSpawn?.(99_004);
          options.onToolProgress?.({
            id: "call-active",
            phase: "start",
            name: "get_command_or_subagent_output",
          });
          await firstGate;
        }
        if (options.logFilePath) {
          await writeFile(
            options.logFilePath,
            [
              JSON.stringify({ type: "text", data: `reply-${runCount}` }),
              JSON.stringify({ type: "end", session_id: sessionId, stopReason: "EndTurn" }),
            ].join("\n"),
          );
        }
        return { exitCode: 0, sessionId };
      },
    };
    const { db, app, repoPath } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime: "grok-build", model: "grok-4.5", runtime_configuration_id: null })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Implement the new runtime continuity plan" }),
    });
    for (let attempt = 0; attempt < 100 && runCount === 0; attempt++) await Bun.sleep(10);
    expect(allocatedId).toMatch(/^[0-9a-f-]{36}$/);

    const queued = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Create the PR when finished", midRunMode: "steer" }),
    });
    expect(queued.status).toBe(201);
    expect(await queued.json()).toMatchObject({ midRun: "queued", queued: true, steered: false });
    expect(runCount).toBe(1);

    releaseFirst?.();
    await waitForPendingChatReplies();

    const runs = await db
      .selectFrom("chat_runs")
      .select([
        "status",
        "interruption_kind",
        "runtime_session_id",
        "resume_session_id",
        "workspace_path",
      ])
      .where("session_id", "=", session.id)
      .orderBy("created_at")
      .execute();
    expect(runs[0]).toMatchObject({
      status: "completed",
      interruption_kind: null,
      runtime_session_id: allocatedId,
      workspace_path: await realpath(repoPath),
    });
    expect(runs[1]).toMatchObject({
      status: "completed",
      interruption_kind: null,
      resume_session_id: allocatedId,
      workspace_path: await realpath(repoPath),
    });
    expect(resumeIds[1]).toBe(allocatedId);
    expect(prompts[1]).toContain("Create the PR when finished");
    expect(prompts[1]).not.toContain("[assistant interrupted partial]");
    await teardown(db);
  });

  test("automatically retries a silent Grok resume once with fresh AOP history", async () => {
    const prompts: string[] = [];
    const resumeIds: Array<string | undefined> = [];
    const freshIds: Array<string | undefined> = [];
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        prompts.push(options.prompt);
        resumeIds.push(options.resumeSessionId);
        freshIds.push(options.newSessionId);
        if (options.resumeSessionId) return { exitCode: 1, startupTimedOut: true };
        await writeFile(
          options.logFilePath ?? "",
          [
            JSON.stringify({ type: "text", data: "Recovered automatically" }),
            JSON.stringify({
              type: "end",
              session_id: options.newSessionId,
              stopReason: "EndTurn",
            }),
          ].join("\n"),
        );
        return { exitCode: 0, sessionId: options.newSessionId };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    const historyCreatedAt = new Date(Date.now() - 1_000).toISOString();
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_grok_silent_history",
        session_id: session.id,
        role: "user",
        content: "Investigate the recurring Grok stall",
        action: null,
        created_at: historyCreatedAt,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_grok_silent_history",
        session_id: session.id,
        user_message_id: "smsg_grok_silent_history",
        assistant_message_id: "smsg_grok_silent_history_assistant",
        runtime: "grok-build",
        log_file_path: join(tmpdir(), "grok-silent-history.jsonl"),
        status: "completed",
        runtime_session_id: "stale-grok-session",
        resume_session_id: null,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: "fresh",
        workspace_path: null,
        timeout_policy: null,
        retry_of_run_id: null,
        runtime_session_state: "confirmed",
        error_message: null,
        created_at: historyCreatedAt,
        updated_at: historyCreatedAt,
      })
      .execute();
    await db
      .updateTable("chat_sessions")
      .set({
        runtime: "grok-build",
        model: "grok-4.5",
        runtime_configuration_id: null,
        runtime_session_id: "stale-grok-session",
      })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Continue the previous investigation" }),
    });
    await waitForPendingChatReplies();

    expect(resumeIds).toEqual(["stale-grok-session", undefined]);
    expect(freshIds[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(prompts[1]).toContain("<aop_conversation_context>");
    expect(prompts[1]).toContain("Investigate the recurring Grok stall");
    expect(prompts[1]).toContain("Continue the previous investigation");
    const run = await db
      .selectFrom("chat_runs")
      .select(["status", "failure_kind", "context_strategy", "runtime_session_id"])
      .where("session_id", "=", session.id)
      .where("id", "!=", "crun_grok_silent_history")
      .executeTakeFirstOrThrow();
    expect(run).toMatchObject({
      status: "completed",
      failure_kind: null,
      context_strategy: "aop_history",
      runtime_session_id: freshIds[1],
    });

    await teardown(db);
  });

  test("skips an unsafe persisted Grok resume and preallocates a fresh session", async () => {
    const staleSessionId = crypto.randomUUID();
    const freshIds: Array<string | undefined> = [];
    const resumeIds: Array<string | undefined> = [];
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        freshIds.push(options.newSessionId);
        resumeIds.push(options.resumeSessionId);
        const sessionId = options.newSessionId ?? crypto.randomUUID();
        await writeFile(
          options.logFilePath ?? "",
          [
            JSON.stringify({ type: "text", data: "Continued safely" }),
            JSON.stringify({ type: "end", session_id: sessionId, stopReason: "EndTurn" }),
          ].join("\n"),
        );
        return { exitCode: 0, sessionId };
      },
    };
    const { db, app, repoPath } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    const resolvedRepoPath = await realpath(repoPath);
    const journalRoot = join(homedir(), ".grok", "sessions", encodeURIComponent(resolvedRepoPath));
    const sessionDir = join(journalRoot, staleSessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "events.jsonl"),
      `${JSON.stringify({ type: "turn_started" })}\n${JSON.stringify({
        type: "tool_started",
        tool_name: "get_command_or_subagent_output",
      })}\n`,
    );
    await db
      .updateTable("chat_sessions")
      .set({
        runtime: "grok-build",
        model: "grok-4.5",
        runtime_configuration_id: null,
        runtime_session_id: staleSessionId,
      })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Continue without reusing the broken tool wait" }),
    });
    await waitForPendingChatReplies();

    expect(resumeIds).toEqual([undefined]);
    expect(freshIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(freshIds[0]).not.toBe(staleSessionId);
    expect(
      await db
        .selectFrom("chat_runs")
        .select(["status", "context_strategy", "runtime_session_id"])
        .where("session_id", "=", session.id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({
      status: "completed",
      context_strategy: "aop_history",
      runtime_session_id: freshIds[0],
    });

    await rm(journalRoot, { recursive: true, force: true });
    await teardown(db);
  });

  test("retries a startup timeout explicitly and idempotently in a fresh session", async () => {
    let calls = 0;
    const prompts: string[] = [];
    const provider: LLMProvider = {
      name: "retry-fixture",
      run: async (options) => {
        calls += 1;
        prompts.push(options.prompt);
        if (calls === 1) return { exitCode: 1, startupTimedOut: true };
        await writeFixtureAssistantLog(options.logFilePath, "Recovered");
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Implement the risky task" }),
    });
    await waitForPendingChatReplies();
    const failed = await db
      .selectFrom("chat_runs")
      .selectAll()
      .where("session_id", "=", session.id)
      .executeTakeFirstOrThrow();
    await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settledOverride: "settled" }),
    });

    const unconfirmed = await app.request(
      `/api/chat-sessions/${session.id}/runs/${failed.id}/retry-fresh`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    expect(unconfirmed.status).toBe(400);

    const retry = await app.request(
      `/api/chat-sessions/${session.id}/runs/${failed.id}/retry-fresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    expect(retry.status).toBe(201);
    const retryBody = (await retry.json()) as { message: { id: string } };
    await waitForPendingChatReplies();

    const duplicate = await app.request(
      `/api/chat-sessions/${session.id}/runs/${failed.id}/retry-fresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      },
    );
    expect(((await duplicate.json()) as { message: { id: string } }).message.id).toBe(
      retryBody.message.id,
    );
    const runs = await db
      .selectFrom("chat_runs")
      .select(["failure_kind", "retry_of_run_id", "context_strategy"])
      .where("session_id", "=", session.id)
      .orderBy("created_at")
      .execute();
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({
      retry_of_run_id: failed.id,
      context_strategy: "aop_history",
    });
    const awakened = await db
      .selectFrom("chat_sessions")
      .select(["settled_override", "settled_at"])
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(awakened).toEqual({ settled_override: null, settled_at: null });
    expect(prompts[1]?.match(/Implement the risky task/g)).toHaveLength(1);
    await teardown(db);
  });

  test("does not persist a fresh retry when another reply owns the session", async () => {
    let calls = 0;
    let releaseActiveReply: (() => void) | undefined;
    const activeReply = new Promise<void>((resolve) => {
      releaseActiveReply = resolve;
    });
    const provider: LLMProvider = {
      name: "retry-ownership-fixture",
      run: async (options) => {
        calls += 1;
        if (calls === 1) return { exitCode: 1, startupTimedOut: true };
        await activeReply;
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Create the startup timeout" }),
    });
    await waitForPendingChatReplies();
    const failed = await db
      .selectFrom("chat_runs")
      .selectAll()
      .where("session_id", "=", session.id)
      .executeTakeFirstOrThrow();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Keep this reply active" }),
    });
    for (let attempt = 0; attempt < 50 && calls < 2; attempt++) await Bun.sleep(10);

    const retry = await app.request(
      `/api/chat-sessions/${session.id}/runs/${failed.id}/retry-fresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      },
    );

    expect(retry.status).toBe(409);
    expect(
      await db
        .selectFrom("chat_runs")
        .select("id")
        .where("retry_of_run_id", "=", failed.id)
        .execute(),
    ).toHaveLength(0);

    releaseActiveReply?.();
    await waitForPendingChatReplies();
    await teardown(db);
  });

  test("rejects an invalid explicit mid-run mode", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const response = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello", midRunMode: "destroy" }),
    });
    expect(response.status).toBe(400);
    await teardown(db);
  });

  test("/clear settles the current session and creates a neutral sibling", async () => {
    const provider: LLMProvider = {
      name: "unused-for-clear",
      run: async () => ({ exitCode: 0 }),
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    // Unbind configuration so a custom alias is not re-resolved from Runtime configuration.
    await db
      .updateTable("chat_sessions")
      .set({
        runtime_session_id: "cli-thread-old",
        runtime_alias: "cx",
        runtime_configuration_id: null,
      })
      .where("id", "=", session.id)
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/clear" }),
    });
    expect(response.status).toBe(201);
    await waitForPendingChatReplies();

    const settled = await db
      .selectFrom("chat_sessions")
      .selectAll()
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(settled.settled_override).toBe("settled");
    expect(settled.settled_at).toBeString();
    expect(Boolean(settled.pinned)).toBe(false);

    const siblings = await db
      .selectFrom("chat_sessions")
      .selectAll()
      .where("repo_id", "=", "repo_chat_1")
      .where("settled_override", "is", null)
      .execute();
    expect(siblings).toHaveLength(1);
    expect(siblings[0]?.id).not.toBe(session.id);
    expect(siblings[0]?.runtime_session_id).toBeNull();
    expect(siblings[0]?.runtime_alias).toBe("cx");

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: {
        settledOverride: "settled" | "active" | null;
        settledAt: string | null;
        messages: Array<{
          role: string;
          content: string;
          action: { type: string; id?: string } | null;
        }>;
      };
    };
    expect(body.session.settledOverride).toBe("settled");
    expect(body.session.settledAt).toBeString();
    const assistant = body.session.messages.find((m) => m.role === "assistant");
    expect(assistant?.action?.type).toBe("session");
    expect(assistant?.action?.id).toBe(siblings[0]?.id);
    expect(assistant?.content).toContain("Settled");

    await teardown(db);
  });

  test("marks an ordinary provider failure as a failed durable run", async () => {
    const provider: LLMProvider = {
      name: "failing-fixture",
      run: async () => ({ exitCode: 1 }),
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    const response = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Fail the runtime" }),
    });
    expect(response.status).toBe(201);
    await waitForPendingChatReplies();

    const run = await db
      .selectFrom("chat_runs")
      .select(["status", "error_message"])
      .where("session_id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("failed");
    expect(run.error_message).toContain("Runtime exited with code 1");

    await teardown(db);
  });

  test("does not switch runtime while a durable run is active", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const now = new Date().toISOString();

    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_active_runtime_user",
        session_id: session.id,
        role: "user",
        content: "Continue working",
        action: null,
        created_at: now,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_active_runtime",
        session_id: session.id,
        user_message_id: "smsg_active_runtime_user",
        assistant_message_id: "smsg_active_runtime_assistant",
        runtime: "grok-build",
        log_file_path: join(repoPath, "runtime-still-running.jsonl"),
        status: "running",
        runtime_session_id: null,
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "codex-cli" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Cannot settle or change runtime while a run is in progress",
    });

    const settle = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settledOverride: "settled" }),
    });
    expect(settle.status).toBe(409);
    expect(await settle.json()).toEqual({
      error: "Cannot settle or change runtime while a run is in progress",
    });

    await teardown(db);
  });

  test("patches title, pin, settlement override, runtime, model, and effort", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");

    const renamed = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Standup notes" }),
    });
    expect(renamed.status).toBe(200);
    const renamedBody = (await renamed.json()) as {
      session: { title: string; named: boolean; runtimeSessionId: string | null };
    };
    expect(renamedBody.session.title).toBe("Standup notes");
    expect(renamedBody.session.named).toBe(true);

    // seed a runtime session id so runtime switch clears it
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "cli-sess-1" })
      .where("id", "=", session.id)
      .execute();

    const runtimeSwitch = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "codex-cli" }),
    });
    expect(runtimeSwitch.status).toBe(200);
    const runtimeBody = (await runtimeSwitch.json()) as {
      session: {
        runtime: string;
        model: string;
        runtimeSessionId: string | null;
      };
    };
    expect(runtimeBody.session.runtime).toBe("codex-cli");
    expect(runtimeBody.session.model).toBe(getWorkflowModelOptions("codex-cli")[0] ?? "");
    expect(runtimeBody.session.runtimeSessionId).toBeNull();

    const modelPatch = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getWorkflowModelOptions("codex-cli")[1] ?? "" }),
    });
    expect(modelPatch.status).toBe(200);

    const effortPatch = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reasoningEffort: "high" }),
    });
    expect(effortPatch.status).toBe(200);
    const effortBody = (await effortPatch.json()) as { session: { reasoningEffort: string } };
    expect(effortBody.session.reasoningEffort).toBe("high");

    const settled = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settledOverride: "settled", pinned: true }),
    });
    expect(settled.status).toBe(200);
    const settledBody = (await settled.json()) as {
      session: { settledOverride: string | null; settledAt: string | null; pinned: boolean };
    };
    expect(settledBody.session.settledOverride).toBe("settled");
    expect(settledBody.session.settledAt).toBeString();
    expect(settledBody.session.pinned).toBe(false);

    const active = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settledOverride: "active" }),
    });
    expect(active.status).toBe(200);
    const activeBody = (await active.json()) as {
      session: { settledOverride: string | null; settledAt: string | null };
    };
    expect(activeBody.session.settledOverride).toBe("active");
    expect(activeBody.session.settledAt).toBeNull();

    const activity = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Resume this conversation" }),
    });
    expect(activity.status).toBe(201);
    const afterActivity = await db
      .selectFrom("chat_sessions")
      .select(["settled_override", "settled_at"])
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(afterActivity).toEqual({ settled_override: null, settled_at: null });
    await waitForPendingChatReplies();

    const invalid = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settledOverride: "done" }),
    });
    expect(invalid.status).toBe(400);

    await teardown(db);
  });

  test("applies a saved runtime profile as a full session preset", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "old-runtime-session" })
      .where("id", "=", session.id)
      .execute();
    await db
      .insertInto("runtime_profiles")
      .values({
        id: "rprof_chat_codex",
        name: "Work Codex",
        base_provider: "codex-cli",
        command: "cdx",
        model: "vendor/custom-model:v2",
        reasoning: "extra-high",
        fast_mode: true,
      })
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtimeProfileId: "rprof_chat_codex" }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({
      session: {
        runtime: "codex-cli",
        runtimeAlias: "cdx",
        model: "vendor/custom-model:v2",
        reasoningEffort: "extra-high",
        fastMode: true,
        runtimeSessionId: null,
      },
    });
    await teardown(db);
  });

  test("locks the model after the session has its first message", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_model_lock",
        session_id: session.id,
        role: "user",
        content: "first message",
        action: null,
        created_at: new Date().toISOString(),
      })
      .execute();

    const modelPatch = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getWorkflowModelOptions("claude-code")[1] ?? "" }),
    });
    expect(modelPatch.status).toBe(409);
    expect(await modelPatch.json()).toEqual({
      error: "Model cannot be changed after the session has started",
    });

    // runtime switches stay allowed after the first message
    const runtimeSwitch = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "codex-cli" }),
    });
    expect(runtimeSwitch.status).toBe(200);

    const effortPatch = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reasoningEffort: "high" }),
    });
    expect(effortPatch.status).toBe(200);
    expect(
      ((await effortPatch.json()) as { session: { reasoningEffort: string } }).session
        .reasoningEffort,
    ).toBe("high");

    const titlePatch = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Still editable" }),
    });
    expect(titlePatch.status).toBe(200);

    await teardown(db);
  });

  test("applies the shared catalog default when selecting a built-in runtime configuration", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");

    const response = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtimeConfigurationId: "codex-cli" }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({
      session: {
        runtime: "codex-cli",
        runtimeConfigurationId: "codex-cli",
        model: getWorkflowModelOptions("codex-cli")[0],
      },
    });

    await teardown(db);
  });

  test("applies a saved runtime configuration as a session runtime", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: "rtprov_claude_personal",
        name: "Claude Code personal",
        command: "claude-personal",
        driver: "claude-code",
        built_in: false,
      })
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: "rtmodel_claude_personal_opus",
        provider_id: "rtprov_claude_personal",
        description: "Opus 4.8",
        model: "claude-opus-4-8",
        thinking_levels: JSON.stringify(["low", "medium", "high", "max"]),
        fast_mode: false,
        built_in: false,
        position: 0,
        is_default: false,
      })
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: "rtmodel_claude_personal_haiku",
        provider_id: "rtprov_claude_personal",
        description: "Haiku 4.5",
        model: "claude-personal-haiku",
        thinking_levels: JSON.stringify(["low", "medium"]),
        fast_mode: false,
        built_in: false,
        position: 1,
        is_default: true,
      })
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtimeConfigurationId: "rtprov_claude_personal" }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({
      session: {
        runtime: "claude-code",
        runtimeConfigurationId: "rtprov_claude_personal",
        runtimeAlias: "claude-personal",
        model: "claude-personal-haiku",
        reasoningEffort: "low",
        fastMode: false,
        defaultWorkerId: null,
        defaultWorkflowId: null,
      },
    });

    const modelResponse = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-personal-haiku" }),
    });
    expect(modelResponse.status).toBe(200);
    expect((await modelResponse.json()) as unknown).toMatchObject({
      session: {
        runtimeConfigurationId: "rtprov_claude_personal",
        model: "claude-personal-haiku",
        // Same model re-selected keeps the previously resolved effort.
        reasoningEffort: "low",
      },
    });
    await teardown(db);
  });

  test("preserves the selected configured model when changing thinking effort", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: "rtprov_grok_ordered",
        name: "Ordered Grok",
        command: "grok",
        driver: "grok-build",
        built_in: false,
      })
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values([
        {
          id: "rtmodel_composer_first",
          provider_id: "rtprov_grok_ordered",
          description: "Composer 2.5",
          model: "grok-composer-2.5-fast",
          thinking_levels: JSON.stringify([]),
          fast_mode: false,
          built_in: false,
        },
        {
          id: "rtmodel_grok_second",
          provider_id: "rtprov_grok_ordered",
          description: "Grok 4.5",
          model: "grok-4.5",
          thinking_levels: JSON.stringify(["low", "medium", "high"]),
          fast_mode: false,
          built_in: false,
        },
      ])
      .execute();

    await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtimeConfigurationId: "rtprov_grok_ordered" }),
    });
    await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-4.5" }),
    });
    const effortResponse = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reasoningEffort: "high" }),
    });

    expect(effortResponse.status).toBe(200);
    expect((await effortResponse.json()) as unknown).toMatchObject({
      session: {
        model: "grok-4.5",
        reasoningEffort: "high",
      },
    });
    await teardown(db);
  });

  test("updates the runtime access mode", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");

    const response = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtimeAccessMode: "auto" }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({
      session: { runtimeAccessMode: "auto" },
    });
    await teardown(db);
  });

  test("toggles fast mode while bound to a runtime configuration that supports it", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: "rtprov_fast_codex",
        name: "Fast Codex",
        command: "codex",
        driver: "codex-cli",
        built_in: false,
        supports_fast_mode: true,
      })
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: "rtmodel_fast_codex",
        provider_id: "rtprov_fast_codex",
        description: "GPT 5.5",
        model: "gpt-5.5",
        thinking_levels: JSON.stringify(["medium", "high"]),
        fast_mode: false,
        built_in: false,
        position: 0,
        is_default: true,
      })
      .execute();

    expect(
      (
        await app.request(`/api/chat-sessions/${session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runtimeConfigurationId: "rtprov_fast_codex" }),
        })
      ).status,
    ).toBe(200);

    const enable = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fastMode: true }),
    });
    expect(enable.status).toBe(200);
    expect((await enable.json()) as unknown).toMatchObject({
      session: { fastMode: true, runtimeConfigurationId: "rtprov_fast_codex" },
    });

    const disable = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fastMode: false }),
    });
    expect(disable.status).toBe(200);
    expect((await disable.json()) as unknown).toMatchObject({
      session: { fastMode: false, runtimeConfigurationId: "rtprov_fast_codex" },
    });
    await teardown(db);
  });

  test("migrates a legacy runtime configuration id when toggling fast mode", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({
        runtime: "codex-cli",
        runtime_configuration_id: "legacy-codex-cli",
        model: "gpt-5.6",
        fast_mode: false,
      })
      .where("id", "=", session.id)
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fastMode: true }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({
      session: { fastMode: true, runtimeConfigurationId: null },
    });
    await teardown(db);
  });

  test("resolves a saved runtime configuration again before each session run", async () => {
    let runOptions: Parameters<LLMProvider["run"]>[0] | undefined;
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        runOptions = options;
        await writeFixtureAssistantLog(options.logFilePath);
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .insertInto("runtime_configuration_providers")
      .values({
        id: "rtprov_work_codex",
        name: "Work Codex",
        command: "codex-old",
        driver: "codex-cli",
        built_in: false,
      })
      .execute();
    await db
      .insertInto("runtime_configuration_models")
      .values({
        id: "rtmodel_work_codex",
        provider_id: "rtprov_work_codex",
        description: "Work GPT",
        model: "work/gpt-old",
        thinking_levels: JSON.stringify(["medium", "high"]),
        fast_mode: false,
        built_in: false,
      })
      .execute();
    expect(
      (
        await app.request(`/api/chat-sessions/${session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runtimeConfigurationId: "rtprov_work_codex" }),
        })
      ).status,
    ).toBe(200);
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "codex-session-existing" })
      .where("id", "=", session.id)
      .execute();

    await db
      .updateTable("runtime_configuration_providers")
      .set({ command: "codex-current" })
      .where("id", "=", "rtprov_work_codex")
      .execute();
    await db
      .updateTable("runtime_configuration_models")
      .set({ model: "work/gpt-current", thinking_levels: JSON.stringify(["high"]) })
      .where("id", "=", "rtmodel_work_codex")
      .execute();

    expect(
      (
        await app.request(`/api/chat-sessions/${session.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "use the current configuration" }),
        })
      ).status,
    ).toBe(201);
    await waitForPendingChatReplies();

    expect(runOptions).toMatchObject({
      runtimeAlias: "codex-current",
      model: "work/gpt-current",
      reasoningEffort: "high",
      fastMode: false,
      browserControl: false,
      computerControl: false,
      resumeSessionId: "codex-session-existing",
    });
    await teardown(db);
  });

  test("rejects invalid runtime, model, and effort", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");

    const badRuntime = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtime: "cursor-cli" }),
    });
    expect(badRuntime.status).toBe(400);

    const badModel = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "not-a-real-model" }),
    });
    expect(badModel.status).toBe(400);

    const badEffort = await app.request(`/api/chat-sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reasoningEffort: "ultra" }),
    });
    expect(badEffort.status).toBe(400);

    await teardown(db);
  });

  test("SSE stream returns 404 for unknown session and emits connected + session events", async () => {
    const { db, app } = await setup();
    const missing = await app.request("/api/chat-sessions/nope/stream");
    expect(missing.status).toBe(404);

    const session = await createSession(app, "repo_chat_1");
    const controller = new AbortController();
    const response = await app.request(`/api/chat-sessions/${session.id}/stream`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    if (!reader) {
      await teardown(db);
      return;
    }

    const text = await collectSessionStreamEvents(reader, session.id);
    controller.abort();
    releaseReader(reader);

    expect(text).toContain("event: connected");
    expect(text).toContain("assistant-typing");
    expect(text).toContain("assistant-final");
    expect(text).toContain("session-updated");
    expect(text).toContain("streamed reply");

    await teardown(db);
  });

  test("SSE stream replays the latest assistant progress when reconnecting", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const { publishChatSessionEvent } = await import("./session-events.ts");
    publishChatSessionEvent({
      type: "assistant-progress",
      sessionId: session.id,
      thinking: "Inspecting the session",
      content: "I found the active run",
      commandGroups: [],
    });

    const controller = new AbortController();
    const response = await app.request(`/api/chat-sessions/${session.id}/stream`, {
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    if (!reader) {
      await teardown(db);
      return;
    }

    const text = await readSessionStreamUntil(reader, "I found the active run");
    controller.abort();
    releaseReader(reader);
    await Bun.sleep(20);

    expect(text).toContain("event: connected");
    expect(text).toContain("event: assistant-progress");
    expect(text).toContain("Inspecting the session");
    expect(text).toContain("I found the active run");
    await teardown(db);
  });

  test("terminal endpoint runs command and returns lines", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await Bun.write(join(repoPath, "marker.txt"), "hi");

    const response = await app.request(`/api/chat-sessions/${session.id}/terminal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "ls" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      lines: Array<{ text: string; tone: string }>;
    };
    expect(body.lines.some((l) => l.text.includes("marker.txt"))).toBe(true);
    expect(body.lines.some((l) => l.tone === "cmd")).toBe(true);

    const empty = await app.request(`/api/chat-sessions/${session.id}/terminal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "  " }),
    });
    expect(empty.status).toBe(400);

    await teardown(db);
  });

  test("get includes skills array", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const response = await app.request(`/api/chat-sessions/${session.id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { session: { skills: string[] } };
    expect(Array.isArray(body.session.skills)).toBe(true);
    await teardown(db);
  });

  test("auto-titles from the first message unless the session is named", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");

    const send = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/task Fix flaky teardown @k6 please" }),
    });
    expect(send.status).toBe(201);
    const body = (await send.json()) as { session: { title: string; named: boolean } };
    expect(body.session.named).toBe(false);
    expect(body.session.title).toBe("Fix flaky teardown please");

    const named = await createSession(app, "repo_chat_1");
    await app.request(`/api/chat-sessions/${named.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Explicit name" }),
    });
    const sendNamed = await app.request(`/api/chat-sessions/${named.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "this should not rename" }),
    });
    const namedBody = (await sendNamed.json()) as { session: { title: string } };
    expect(namedBody.session.title).toBe("Explicit name");

    await teardown(db);
  });

  test("accepts attachments, serves them, and strips metadata from content", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");

    const send = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "What is in this screenshot?",
        imageAttachments: [
          {
            id: "img_1",
            mimeType: "image/png",
            dataBase64: Buffer.from("png-bytes-for-chat").toString("base64"),
          },
        ],
        documentAttachments: [
          {
            id: "doc_1",
            fileName: "implementation.md",
            mimeType: "text/markdown",
            dataBase64: Buffer.from("# Implementation\n\nUse the plan.").toString("base64"),
          },
          {
            id: "doc_2",
            fileName: "report.csv",
            mimeType: "text/csv",
            dataBase64: Buffer.from("name,value\na,1").toString("base64"),
          },
        ],
      }),
    });
    expect(send.status).toBe(201);
    const sendBody = (await send.json()) as {
      message: {
        content: string;
        images: Array<{ id: string; url: string; mimeType: string }>;
        documents: Array<{ id: string; fileName: string; url: string; mimeType: string }>;
      };
    };
    expect(sendBody.message.content).toBe("What is in this screenshot?");
    expect(sendBody.message.content).not.toContain("aop-chat-images");
    expect(sendBody.message.images).toHaveLength(1);
    expect(sendBody.message.images[0]?.id).toBe("img_1");
    expect(sendBody.message.images[0]?.mimeType).toBe("image/png");
    expect(sendBody.message.documents).toHaveLength(2);
    expect(sendBody.message.documents[0]?.fileName).toBe("implementation.md");

    const imageUrl = sendBody.message.images[0]?.url ?? "";
    expect(imageUrl).toContain(`/api/chat-sessions/${session.id}/attachments/`);
    const fileResponse = await app.request(imageUrl);
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await fileResponse.arrayBuffer()).toString("utf8")).toBe(
      "png-bytes-for-chat",
    );
    const documentResponse = await app.request(sendBody.message.documents[0]?.url ?? "");
    expect(documentResponse.status).toBe(200);
    expect(documentResponse.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(await documentResponse.text()).toBe("# Implementation\n\nUse the plan.");
    const csvResponse = await app.request(sendBody.message.documents[1]?.url ?? "");
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(await csvResponse.text()).toBe("name,value\na,1");

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const detailBody = (await detail.json()) as {
      session: {
        messages: Array<{ content: string; images: unknown[]; documents: unknown[] }>;
      };
    };
    const userMsg = detailBody.session.messages.find((m) => m.content.includes("screenshot"));
    expect(userMsg?.images).toHaveLength(1);
    expect(userMsg?.documents).toHaveLength(2);

    await teardown(db);
  });

  test("reset-runtime clears an idle bound session", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "idle-bind" })
      .where("id", "=", session.id)
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}/reset-runtime`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reset: true,
      clearedBinding: true,
      cancelledRun: false,
    });

    const bound = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(bound.runtime_session_id).toBeNull();

    const again = await app.request(`/api/chat-sessions/${session.id}/reset-runtime`, {
      method: "POST",
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ reset: true, cancelledRun: false });

    const missing = await app.request("/api/chat-sessions/isess_missing/reset-runtime", {
      method: "POST",
    });
    expect(missing.status).toBe(404);

    await teardown(db);
  });

  test("reset-runtime cancels an orphaned durable run and clears binding", async () => {
    const { db, app, repoPath } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const now = new Date().toISOString();
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "orphan-bind" })
      .where("id", "=", session.id)
      .execute();
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_reset_user",
        session_id: session.id,
        role: "user",
        content: "stuck",
        action: null,
        created_at: now,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_reset_orphan",
        session_id: session.id,
        user_message_id: "smsg_reset_user",
        assistant_message_id: "smsg_reset_assistant",
        runtime: "codex-cli",
        log_file_path: join(repoPath, "reset-orphan.jsonl"),
        status: "running",
        runtime_session_id: "orphan-bind",
        resume_session_id: "orphan-bind",
        failure_kind: null,
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const response = await app.request(`/api/chat-sessions/${session.id}/reset-runtime`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reset: boolean;
      clearedBinding: boolean;
      cancelledRun: boolean;
    };
    expect(body.reset).toBe(true);
    expect(body.cancelledRun).toBe(true);
    expect(body.clearedBinding).toBe(true);

    const run = await db
      .selectFrom("chat_runs")
      .select("status")
      .where("id", "=", "crun_reset_orphan")
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("cancelled");
    const bound = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(bound.runtime_session_id).toBeNull();

    await teardown(db);
  });

  test("reset-runtime aborts an active run, cancels queued steers, and clears binding", async () => {
    let runCount = 0;
    const hangForever = new Promise<void>(() => {
      /* never resolves */
    });
    const provider: LLMProvider = {
      name: "reset-active-fixture",
      run: async (options) => {
        runCount += 1;
        if (runCount > 1) return { exitCode: 0 };
        await options.onSpawn?.(99_003);
        await hangForever;
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "active-bind" })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Keep working" }),
    });
    for (let attempt = 0; attempt < 50 && runCount === 0; attempt++) await Bun.sleep(10);
    expect(runCount).toBe(1);

    const queued = await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Queued follow-up" }),
    });
    expect(queued.status).toBe(201);
    const queuedBody = (await queued.json()) as { midRun?: string; queued?: boolean };
    expect(queuedBody.midRun).toBe("queued");
    expect(queuedBody.queued).toBe(true);

    const events: Array<{ type: string; sessionId: string }> = [];
    const { subscribeChatSession } = await import("./session-events.ts");
    const unsubscribe = subscribeChatSession(session.id, (event) => {
      events.push({ type: event.type, sessionId: event.sessionId });
    });

    const response = await app.request(`/api/chat-sessions/${session.id}/reset-runtime`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reset: true,
      clearedBinding: true,
      cancelledRun: true,
    });
    await waitForPendingChatReplies();
    unsubscribe();

    const bound = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(bound.runtime_session_id).toBeNull();

    const runStatuses = await db
      .selectFrom("chat_runs")
      .select("status")
      .where("session_id", "=", session.id)
      .execute();
    expect(runStatuses.every((run) => run.status === "cancelled")).toBe(true);
    expect(runStatuses.length).toBeGreaterThanOrEqual(2);

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const detailBody = (await detail.json()) as {
      session: {
        assistantActive: boolean;
        runtimeSessionId: string | null;
        messages: Array<{ content: string }>;
      };
    };
    expect(detailBody.session.assistantActive).toBe(false);
    expect(detailBody.session.runtimeSessionId).toBeNull();
    expect(
      detailBody.session.messages.some((message) =>
        message.content.includes("Runtime session reset"),
      ),
    ).toBe(true);
    expect(runCount).toBe(1);
    expect(events.some((event) => event.type === "assistant-final")).toBe(true);
    expect(events.some((event) => event.type === "session-updated")).toBe(true);

    await teardown(db);
  });

  test("first bound empty-output failure preserves runtime binding", async () => {
    const provider: LLMProvider = {
      name: "empty-fixture",
      run: async (options) => {
        if (options.logFilePath) {
          await mkdir(join(options.logFilePath, ".."), { recursive: true });
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({ type: "result", subtype: "success" })}\n`,
          );
        }
        return { exitCode: 0, sessionId: "discovered-from-empty" };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "stale-bind-1" })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "first empty" }),
    });
    await waitForPendingChatReplies();

    const bound = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(bound.runtime_session_id).toBe("stale-bind-1");

    const run = await db
      .selectFrom("chat_runs")
      .selectAll()
      .where("session_id", "=", session.id)
      .orderBy("created_at", "desc")
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("failed");
    expect(run.failure_kind).toBe("empty_output");
    expect(run.resume_session_id).toBe("stale-bind-1");
    // Discovered runtime ID is recorded on the run, not promoted to the session binding.
    expect(run.runtime_session_id).toBe("discovered-from-empty");

    await teardown(db);
  });

  test("completed run with a conflicting discovered id keeps the existing binding", async () => {
    const provider: LLMProvider = {
      name: "success-fixture",
      run: async (options) => {
        if (options.logFilePath) {
          await mkdir(join(options.logFilePath, ".."), { recursive: true });
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({ type: "result", subtype: "success", result: "All good" })}\n`,
          );
        }
        return { exitCode: 0, sessionId: "discovered-other-id" };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "existing-binding" })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    await waitForPendingChatReplies();

    const bound = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(bound.runtime_session_id).toBe("existing-binding");

    const run = await db
      .selectFrom("chat_runs")
      .selectAll()
      .where("session_id", "=", session.id)
      .orderBy("created_at", "desc")
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("completed");
    expect(run.runtime_session_id).toBe("discovered-other-id");

    await teardown(db);
  });

  test("first Grok resume silence failure clears runtime binding", async () => {
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        if (options.logFilePath) {
          await mkdir(join(options.logFilePath, ".."), { recursive: true });
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({ type: "result", subtype: "success" })}\n`,
          );
        }
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    // Bind fully to Grok (driver + configuration) so config re-apply does not flip back to Claude.
    await db
      .updateTable("chat_sessions")
      .set({
        runtime: "grok-build",
        runtime_configuration_id: "grok-build",
        runtime_session_id: "stale-grok-bind",
        runtime_alias: "grok",
      })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "grok empty once" }),
    });
    await waitForPendingChatReplies();

    const bound = await db
      .selectFrom("chat_sessions")
      .select(["runtime_session_id", "runtime"])
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(bound.runtime).toBe("grok-build");
    expect(bound.runtime_session_id).toBeNull();

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: { messages: Array<{ content: string }> };
    };
    expect(body.session.messages.at(-1)?.content).toContain("Grok produced no response");

    await teardown(db);
  });

  test("second consecutive empty-output failure clears runtime binding", async () => {
    const provider: LLMProvider = {
      name: "empty-fixture",
      run: async (options) => {
        if (options.logFilePath) {
          await mkdir(join(options.logFilePath, ".."), { recursive: true });
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({ type: "result", subtype: "success" })}\n`,
          );
        }
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "stale-bind-2" })
      .where("id", "=", session.id)
      .execute();

    for (const content of ["first empty", "second empty"]) {
      await app.request(`/api/chat-sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await waitForPendingChatReplies();
    }

    const bound = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(bound.runtime_session_id).toBeNull();

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: { messages: Array<{ content: string }> };
    };
    expect(body.session.messages.at(-1)?.content).toContain("reset the runtime session");

    await teardown(db);
  });

  test("unbound empty-output failure does not clear a later binding via recovery path", async () => {
    const provider: LLMProvider = {
      name: "empty-fixture",
      run: async (options) => {
        if (options.logFilePath) {
          await mkdir(join(options.logFilePath, ".."), { recursive: true });
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({ type: "result", subtype: "success" })}\n`,
          );
        }
        return { exitCode: 0 };
      },
    };
    const { db, app } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "unbound empty" }),
    });
    await waitForPendingChatReplies();

    const run = await db
      .selectFrom("chat_runs")
      .select(["status", "failure_kind", "resume_session_id"])
      .where("session_id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("failed");
    expect(run.failure_kind).toBe("empty_output");
    expect(run.resume_session_id).toBeNull();

    const bound = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    expect(bound.runtime_session_id).toBeNull();

    await teardown(db);
  });

  test("empty-output consecutive clear requires the same resume binding", async () => {
    const provider: LLMProvider = {
      name: "empty-fixture",
      run: async (options) => {
        if (options.logFilePath) {
          await mkdir(join(options.logFilePath, ".."), { recursive: true });
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({ type: "result", subtype: "success" })}\n`,
          );
        }
        return { exitCode: 0 };
      },
    };
    const { db, app, repoPath } = await setup(() => provider);
    const session = await createSession(app, "repo_chat_1");
    const earlier = new Date(Date.now() - 60_000).toISOString();
    await db
      .insertInto("chat_messages")
      .values({
        id: "smsg_prev_empty_user",
        session_id: session.id,
        role: "user",
        content: "prior empty on other bind",
        action: null,
        created_at: earlier,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_prev_empty",
        session_id: session.id,
        user_message_id: "smsg_prev_empty_user",
        assistant_message_id: "smsg_prev_empty_assistant",
        runtime: "codex-cli",
        log_file_path: join(repoPath, "prev-empty.jsonl"),
        status: "failed",
        runtime_session_id: "old-bind",
        resume_session_id: "old-bind",
        failure_kind: "empty_output",
        error_message: "prior empty",
        created_at: earlier,
        updated_at: earlier,
      })
      .execute();

    await db
      .updateTable("chat_sessions")
      .set({ runtime_session_id: "new-bind" })
      .where("id", "=", session.id)
      .execute();

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "empty on new bind" }),
    });
    await waitForPendingChatReplies();

    const bound = await db
      .selectFrom("chat_sessions")
      .select("runtime_session_id")
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
    // Preceding empty-output used a different resume binding — preserve current.
    expect(bound.runtime_session_id).toBe("new-bind");

    await teardown(db);
  });
});

const createSession = async (app: HonoApp, repoId: string) => {
  const response = await app.request("/api/chat-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId }),
  });
  const body = (await response.json()) as { session: { id: string } };
  return body.session;
};

describe("chat-session unread counts", () => {
  test("lists unreadCount for assistant messages and clears it after mark-read", async () => {
    const { db, app } = await setup();
    const session = await createSession(app, "repo_chat_1");
    const now = new Date().toISOString();
    await db
      .insertInto("chat_messages")
      .values([
        {
          id: "smsg_unread_user",
          session_id: session.id,
          role: "user",
          content: "hello",
          action: null,
          created_at: now,
        },
        {
          id: "smsg_unread_a1",
          session_id: session.id,
          role: "assistant",
          content: "reply one",
          action: null,
          created_at: now,
        },
        {
          id: "smsg_unread_a2",
          session_id: session.id,
          role: "assistant",
          content: "reply two",
          action: null,
          created_at: now,
        },
      ])
      .execute();

    const listBefore = await app.request("/api/chat-sessions");
    const beforeBody = (await listBefore.json()) as {
      sessions: Array<{ id: string; unreadCount: number }>;
    };
    expect(beforeBody.sessions.find((item) => item.id === session.id)?.unreadCount).toBe(2);

    const markResponse = await app.request(`/api/chat-sessions/${session.id}/mark-read`, {
      method: "POST",
    });
    expect(markResponse.status).toBe(200);
    const markBody = (await markResponse.json()) as {
      session: { id: string; unreadCount: number };
    };
    expect(markBody.session.id).toBe(session.id);
    expect(markBody.session.unreadCount).toBe(0);

    const listAfter = await app.request("/api/chat-sessions");
    const afterBody = (await listAfter.json()) as {
      sessions: Array<{ id: string; unreadCount: number }>;
    };
    expect(afterBody.sessions.find((item) => item.id === session.id)?.unreadCount).toBe(0);

    await teardown(db);
  });

  test("mark-read returns 404 for unknown sessions", async () => {
    const { db, app } = await setup();
    const response = await app.request("/api/chat-sessions/isess_missing/mark-read", {
      method: "POST",
    });
    expect(response.status).toBe(404);
    await teardown(db);
  });
});

type StreamReader = {
  read: () => Promise<{ value?: Uint8Array; done: boolean }>;
  releaseLock: () => void;
};

const readChunk = async (
  reader: StreamReader,
  timeoutMs: number,
): Promise<{ value?: Uint8Array; done: boolean }> => {
  const timeout = Bun.sleep(timeoutMs).then(() => ({ done: true as const, value: undefined }));
  return Promise.race([reader.read(), timeout]);
};

const publishFixtureSessionEvents = async (sessionId: string): Promise<void> => {
  const { publishChatSessionEvent } = await import("./session-events.ts");
  const now = new Date().toISOString();
  publishChatSessionEvent({ type: "assistant-typing", sessionId, userMessageId: "msg_user_sse_1" });
  publishChatSessionEvent({
    type: "assistant-final",
    sessionId,
    message: {
      id: "msg_sse_1",
      sessionId,
      role: "assistant",
      content: "streamed reply",
      action: null,
      createdAt: now,
      images: [],
      documents: [],
    },
  });
  publishChatSessionEvent({
    type: "session-updated",
    sessionId,
    session: {
      id: sessionId,
      scope: "repository",
      repoId: "repo_chat_1",
      repoName: "repo",
      repoPath: "/tmp",
      workspacePath: "/tmp",
      title: "New session",
      named: false,
      runtime: "claude-code",
      runtimeConfigurationId: null,
      model: "m",
      reasoningEffort: "medium",
      runtimeAlias: null,
      runtimeSessionId: null,
      fastMode: false,
      runtimeAccessMode: "full-access",
      defaultWorkerId: null,
      defaultWorkflowId: null,
      pinned: false,
      settledOverride: null,
      settledAt: null,
      lastActivityAt: null,
      assistantActive: false,
      assistantLifecycle: "idle",
      snippet: null,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  });
};

const collectSessionStreamEvents = async (
  reader: StreamReader,
  sessionId: string,
): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  const first = await readChunk(reader, 500);
  if (first.value) text += decoder.decode(first.value);

  await publishFixtureSessionEvents(sessionId);
  await Bun.sleep(40);

  for (let i = 0; i < 4; i++) {
    const chunk = await readChunk(reader, 200);
    if (chunk.value) text += decoder.decode(chunk.value);
    if (
      text.includes("assistant-typing") &&
      text.includes("assistant-final") &&
      text.includes("session-updated")
    ) {
      break;
    }
  }
  return text;
};

const readSessionStreamUntil = async (reader: StreamReader, expected: string): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  for (let attempt = 0; attempt < 5 && !text.includes(expected); attempt++) {
    const chunk = await readChunk(reader, 100);
    if (chunk.value) text += decoder.decode(chunk.value);
  }
  return text;
};

const releaseReader = (reader: StreamReader): void => {
  try {
    reader.releaseLock();
  } catch {
    // stream may already be closed by abort
  }
};

const waitForRecoveredRun = async (
  db: Awaited<ReturnType<typeof createTestDb>>,
  runId: string,
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await db
      .selectFrom("chat_runs")
      .select("status")
      .where("id", "=", runId)
      .executeTakeFirst();
    if (run?.status === "completed") return;
    await Bun.sleep(20);
  }
  throw new Error("chat run did not recover");
};
