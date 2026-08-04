import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatRuntimeDelegationMarker, parseChatDelegationRuns } from "@aop/common";
import type { LLMProvider } from "@aop/llm-provider";
import { Hono as HonoApp } from "hono";
import { createCommandContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { relayDelegationProgress, startDelegationRun } from "./delegation-runs.ts";
import { createChatSessionRoutes } from "./routes.ts";
import { waitForPendingChatReplies } from "./service.ts";
import { type ChatSessionEvent, subscribeChatSession } from "./session-events.ts";
import type { StreamProgressSnapshot } from "./stream-progress.ts";

describe("delegation wiring", () => {
  test("% delegation records the specialist entry with runtime, model, and completion", async () => {
    const { db, app, session, events } = await setupScenario(() => fixtureProvider());

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Fix the flaky test $DELEGATE_CODEX[gpt-5.4;extra-high]" }),
    });
    await waitForPendingChatReplies();

    const entries = await delegationEntries(db, session.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "delegation",
      label: "Codex",
      runtime: "codex-cli",
      model: "gpt-5.4",
      reasoning: "extra-high",
      status: "completed",
      error: null,
    });

    const updates = delegationUpdates(events);
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[0]?.delegation.status).toBe("active");
    expect(updates.at(-1)?.delegation.status).toBe("completed");
    expect(updates.at(-1)?.delegation.sessionTitle).toBeTruthy();

    await teardown(db);
  });

  test("specialist output stays out of the host stream while the handoff still lands", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: "stream-isolation-fixture",
      run: async (options) => {
        calls += 1;
        await writeFixtureAssistantLog(
          options.logFilePath,
          calls === 1 ? "specialist secret draft" : "host consolidated answer",
        );
        return { exitCode: 0 };
      },
    };
    const { db, app, session, events } = await setupScenario(() => provider);

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Fix the flaky test $DELEGATE_CODEX[gpt-5.4;extra-high]" }),
    });
    await waitForPendingChatReplies();

    const specialistLeak = events.some(
      (event) =>
        event.type === "assistant-progress" && event.content.includes("specialist secret draft"),
    );
    expect(specialistLeak).toBe(false);

    const detail = await app.request(`/api/chat-sessions/${session.id}`);
    const body = (await detail.json()) as {
      session: { messages: Array<{ role: string; content: string }> };
    };
    expect(body.session.messages.at(-1)?.content).toContain("host consolidated answer");

    await teardown(db);
  });

  test("% delegation to a custom runtime configuration uses its name and command", async () => {
    const { db, app, session } = await setupScenario(() => fixtureProvider());
    await seedCcPersonalConfiguration(db);

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `Review the change ${formatRuntimeDelegationMarker({
          id: "claude",
          model: "claude-fable-5",
          reasoning: "low",
          runtimeConfigurationId: "rtprov_cc_personal",
        })}`,
      }),
    });
    await waitForPendingChatReplies();

    const entries = await delegationEntries(db, session.id);
    expect(entries[0]).toMatchObject({
      label: "CC Personal",
      runtime: "claude-code",
      runtimeAlias: "cpe",
      runtimeConfigurationId: "rtprov_cc_personal",
      model: "claude-fable-5",
      reasoning: "low",
      status: "completed",
    });

    await teardown(db);
  });

  test("failed specialist records failed status with an error line", async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: "failing-specialist-fixture",
      run: async (options) => {
        calls += 1;
        await writeFixtureAssistantLog(
          options.logFilePath,
          calls === 1 ? "specialist blew up" : "host summary",
        );
        return { exitCode: calls === 1 ? 1 : 0 };
      },
    };
    const { db, app, session } = await setupScenario(() => provider);

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Review this $DELEGATE_GROK" }),
    });
    await waitForPendingChatReplies();

    const entries = await delegationEntries(db, session.id);
    expect(entries[0]?.status).toBe("failed");
    expect(entries[0]?.error).toBeTruthy();

    await teardown(db);
  });

  test("delegation endpoints list active runs and serve specialist output", async () => {
    const { db, app, session } = await setupScenario(() => fixtureProvider());

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Fix the flaky test $DELEGATE_CODEX[gpt-5.4;extra-high]" }),
    });
    await waitForPendingChatReplies();

    const active = await app.request("/api/chat-sessions/delegations/active");
    const activeBody = (await active.json()) as {
      delegations: Array<{
        id: string;
        sessionId: string;
        sessionTitle: string | null;
        status: string;
        hostRunId: string;
      }>;
    };
    expect(activeBody.delegations).toHaveLength(1);
    expect(activeBody.delegations[0]).toMatchObject({
      sessionId: session.id,
      status: "completed",
      runtime: "codex-cli",
      model: "gpt-5.4",
    });
    expect(activeBody.delegations[0]?.sessionTitle).toBeTruthy();

    const scoped = await app.request(`/api/chat-sessions/${session.id}/delegations`);
    expect(scoped.status).toBe(200);
    const missing = await app.request("/api/chat-sessions/isess_missing/delegations");
    expect(missing.status).toBe(404);

    const delegationId = activeBody.delegations[0]?.id ?? "";
    const output = await app.request(
      `/api/chat-sessions/${session.id}/delegations/${delegationId}/output`,
    );
    expect(output.status).toBe(200);
    const outputBody = (await output.json()) as {
      delegation: { id: string };
      output: { thinking: string; content: string };
    };
    expect(outputBody.delegation.id).toBe(delegationId);
    expect(outputBody.output.content).toContain("fixture assistant reply");

    const unknown = await app.request(
      `/api/chat-sessions/${session.id}/delegations/del_missing/output`,
    );
    expect(unknown.status).toBe(404);

    await teardown(db);
  });

  test("quick actions record writer and post-work specialists", async () => {
    const { db, app, session } = await setupScenario(() => fixtureProvider());

    await app.request(`/api/chat-sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Implement the parser fix and review it",
        runtimeActions: [
          {
            intent: "implement",
            runtimeConfigurationId: "codex-cli",
            model: "gpt-5.5",
            reasoning: "high",
            fastMode: false,
          },
          {
            intent: "review",
            runtimeConfigurationId: "pi",
            model: "openai-codex/gpt-5.5",
            reasoning: "medium",
            fastMode: false,
          },
        ],
      }),
    });
    await waitForPendingChatReplies();

    const entries = await delegationEntries(db, session.id);
    expect(entries).toHaveLength(2);
    const writer = entries.find(
      (entry) => entry.kind === "quick-action" && entry.label === "Implement",
    );
    const reviewer = entries.find(
      (entry) => entry.kind === "quick-action" && entry.label === "Review",
    );
    expect(writer).toMatchObject({ runtime: "codex-cli", model: "gpt-5.5", status: "completed" });
    expect(reviewer).toMatchObject({ runtime: "pi", status: "completed" });

    await teardown(db);
  });

  test("progress relay republishes throttled delegation output and records activity", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const now = new Date().toISOString();
    await ctx.chatSessionRepository.create({
      id: "isess_relay",
      repo_id: null,
      title: "Relay",
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
        id: "smsg_relay_user",
        session_id: "isess_relay",
        role: "user",
        content: "go",
        action: null,
        turn_index: 1,
        disposition: "immediate",
        created_at: now,
      })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id: "crun_relay",
        session_id: "isess_relay",
        user_message_id: "smsg_relay_user",
        assistant_message_id: "smsg_relay_assistant",
        runtime: "claude-code",
        log_file_path: "/tmp/relay-host.jsonl",
        status: "running",
        created_at: now,
        updated_at: now,
      })
      .execute();
    const hostRun = (await db
      .selectFrom("chat_runs")
      .selectAll()
      .where("id", "=", "crun_relay")
      .executeTakeFirstOrThrow()) as ChatRun;
    const entry = await startDelegationRun(ctx, hostRun, {
      kind: "delegation",
      label: "Codex",
      runtime: "codex-cli",
      runtimeAlias: null,
      runtimeConfigurationId: null,
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: false,
      logFilePath: "/tmp/relay-delegate.jsonl",
    });

    const events: ChatSessionEvent[] = [];
    const unsubscribe = subscribeChatSession("isess_relay", (event) => events.push(event));
    let fakeNow = 1_000;
    const relay = relayDelegationProgress(ctx, hostRun, entry.id, {
      publishIntervalMs: 500,
      now: () => fakeNow,
    });

    const progress = (text: string): StreamProgressSnapshot => ({
      thinking: "",
      content: text,
      commandGroups: [],
    });
    relay(progress("first chunk"));
    fakeNow += 100;
    relay(progress("second chunk"));
    fakeNow += 600;
    relay(progress("third chunk"));

    const relayed = events.filter((event) => event.type === "delegation-progress");
    expect(relayed).toHaveLength(2);
    expect(relayed[0]).toMatchObject({ delegationId: entry.id, content: "first chunk" });
    expect(relayed[1]).toMatchObject({ content: "third chunk" });
    // Specialist output never leaks into the host assistant stream.
    expect(events.filter((event) => event.type === "assistant-progress")).toHaveLength(0);

    await waitFor(async () => {
      const entries = await delegationEntries(db, "isess_relay");
      return entries[0]?.activity === "third chunk";
    });
    unsubscribe();
    await db.destroy();
  });
});

const fixtureProvider = (): LLMProvider => ({
  name: "delegation-wiring-fixture",
  run: async (options) => {
    await writeFixtureAssistantLog(options.logFilePath);
    return { exitCode: 0 };
  },
});

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

const setupScenario = async (createProviderFn: () => LLMProvider) => {
  const db = await createTestDb();
  const ctx = createCommandContext(db);
  const repoPath = join(tmpdir(), `aop-delegation-wiring-${crypto.randomUUID()}`);
  await mkdir(repoPath, { recursive: true });
  await createTestRepo(db, "repo_delegation_wiring", repoPath);
  const app = new HonoApp();
  app.route("/api/chat-sessions", createChatSessionRoutes(ctx, { createProviderFn }));

  const created = await app.request("/api/chat-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId: "repo_delegation_wiring" }),
  });
  const { session } = (await created.json()) as { session: { id: string } };
  const events: ChatSessionEvent[] = [];
  const unsubscribe = subscribeChatSession(session.id, (event) => events.push(event));
  unsubscribes.push(unsubscribe);
  return { db, app, session, events };
};

const unsubscribes: Array<() => void> = [];

const teardown = async (db: Awaited<ReturnType<typeof createTestDb>>) => {
  await waitForPendingChatReplies();
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  await db.destroy();
};

const seedCcPersonalConfiguration = async (db: Awaited<ReturnType<typeof createTestDb>>) => {
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
};

const delegationEntries = async (
  db: Awaited<ReturnType<typeof createTestDb>>,
  sessionId: string,
) => {
  const runs = await db
    .selectFrom("chat_runs")
    .select("delegation_runs")
    .where("session_id", "=", sessionId)
    .execute();
  return runs.flatMap((row) => parseChatDelegationRuns(row.delegation_runs));
};

const delegationUpdates = (events: ChatSessionEvent[]) =>
  events.filter((event) => event.type === "delegation-updated");

const waitFor = async (assertion: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await Bun.sleep(25);
  }
  expect(await assertion()).toBe(true);
};
