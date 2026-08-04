import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { useTestAopHome } from "@aop/infra";
import type { LLMProvider, RunOptions, RunResult } from "@aop/llm-provider";
import type { Kysely } from "kysely";

const recordedPrompts: string[] = [];

/** Provider used for every workflow step: writes a canonical success log. */
const makeFixtureProvider = (signal: string): LLMProvider => ({
  name: "wf-fixture",
  run: async (options: RunOptions): Promise<RunResult> => {
    recordedPrompts.push(options.prompt);
    if (options.logFilePath) {
      await mkdir(dirname(options.logFilePath), { recursive: true });
      await writeFile(
        options.logFilePath,
        `${JSON.stringify({ type: "result", subtype: "success", result: `Step done <aop>${signal}</aop>` })}\n`,
      );
    }
    return { exitCode: 0 };
  },
});

let fixtureProvider: LLMProvider = makeFixtureProvider("TESTS_PASS");

const { createCommandContext } = await import("../context.ts");
const { createTestDb, createTestRepo } = await import("../db/test-utils.ts");
const { createChatSessionRoutes } = await import("./routes.ts");
const { waitForPendingWorkflowRuns } = await import("./workflow-run.ts");
const { Hono } = await import("hono");

describe("chat workflow runs", () => {
  let db: Kysely<import("../db/schema.ts").Database>;
  let ctx: import("../context.ts").LocalServerContext;
  let app: ReturnType<typeof createChatSessionRoutes>;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    recordedPrompts.length = 0;
    fixtureProvider = makeFixtureProvider("TESTS_PASS");
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route(
      "/api/chat-sessions",
      createChatSessionRoutes(ctx, { createProviderFn: () => fixtureProvider }),
    );
    await createTestRepo(db, "repo_wf_1", "/tmp/wf-repo-1");
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  const createSession = async (): Promise<string> => {
    const response = await app.request("/api/chat-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: "repo_wf_1" }),
    });
    const body = (await response.json()) as { session: { id: string } };
    return body.session.id;
  };

  const seedWorkflow = async (name: string, steps: Record<string, unknown>): Promise<string> => {
    const definition = {
      version: 1,
      name,
      initialStep: "implement-1",
      steps,
      terminalStates: ["__done__", "__blocked__", "__paused__", "__draft__"],
    };
    await ctx.workflowRepository.upsert({
      id: name,
      name,
      definition: JSON.stringify(definition),
      source: "user",
    });
    return name;
  };

  // "pi" passes step-agent validation; the mocked provider factory replaces it.
  const fixtureAgent = { provider: "pi" as const, model: "gpt-5.5", reasoning: "medium" as const };

  const twoStepWorkflow = (): Promise<string> =>
    seedWorkflow("two-step", {
      "implement-1": {
        id: "implement-1",
        type: "implement",
        promptTemplate: "implement.md.hbs",
        maxAttempts: 1,
        agent: fixtureAgent,
        transitions: [
          { condition: "success", target: "run-tests-2" },
          { condition: "failure", target: "__blocked__" },
        ],
      },
      "run-tests-2": {
        id: "run-tests-2",
        type: "test",
        promptTemplate: "run-tests.md.hbs",
        maxAttempts: 1,
        agent: fixtureAgent,
        signals: [{ name: "TESTS_PASS", description: "tests pass" }],
        transitions: [
          { condition: "TESTS_PASS", target: "__done__" },
          { condition: "failure", target: "__blocked__" },
        ],
      },
    });

  const sendArmed = async (sessionId: string, workflowId: string, content: string) =>
    app.request(`/api/chat-sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, workflowId, workflowArmed: true }),
    });

  const listMessages = async (sessionId: string) => {
    const response = await app.request(`/api/chat-sessions/${sessionId}`);
    const body = (await response.json()) as {
      session: { messages: Array<{ role: string; content: string }> };
    };
    return body.session.messages;
  };

  test("runs an armed workflow sequentially and posts the final output as the answer", async () => {
    const workflowId = await twoStepWorkflow();
    const sessionId = await createSession();

    const response = await sendArmed(sessionId, workflowId, "Build the widget");
    expect(response.status).toBe(201);

    await waitForPendingWorkflowRuns();

    const messages = await listMessages(sessionId);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.content).toBe("Build the widget");
    expect(messages[1]?.content).toContain("Step done");

    const run = await ctx.db
      .selectFrom("workflow_runs")
      .selectAll()
      .where("session_id", "=", sessionId)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("done");
    expect(JSON.parse(run.visited_steps ?? "[]")).toEqual(["implement-1", "run-tests-2"]);
    expect(run.answer_message_id).not.toBeNull();
  });

  test("runs each step as its own agent pass, in order", async () => {
    const workflowId = await twoStepWorkflow();
    const sessionId = await createSession();

    await sendArmed(sessionId, workflowId, "Order matters");
    await waitForPendingWorkflowRuns();

    expect(recordedPrompts).toHaveLength(2);
    expect(recordedPrompts[0]).toContain("You are implementing a task");
    expect(recordedPrompts[0]).toContain("Order matters");
    expect(recordedPrompts[1]).toContain("You are running tests");
  });

  test("rejects every send while a workflow run is active", async () => {
    const sessionId = await createSession();
    await ctx.db
      .insertInto("workflow_runs")
      .values({
        id: "wfr_lock",
        session_id: sessionId,
        workflow_id: "two-step",
        workflow_name: "two-step",
        status: "running",
        request: "in flight",
        user_message_id: "smsg_lock",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        iteration: 0,
      })
      .execute();
    await ctx.db
      .insertInto("chat_messages")
      .values({
        id: "smsg_lock",
        session_id: sessionId,
        role: "user",
        content: "in flight",
        turn_index: 0,
        disposition: "immediate",
        created_at: new Date().toISOString(),
      })
      .execute();

    const response = await sendArmed(sessionId, "two-step", "Another message");
    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("WORKFLOW_RUN_IN_PROGRESS");

    const plain = await app.request(`/api/chat-sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Normal message" }),
    });
    expect(plain.status).toBe(409);
  });

  test("posts a blocked terminal message when no transition matches", async () => {
    fixtureProvider = makeFixtureProvider("REVIEW_PASSED");
    const workflowId = await seedWorkflow("blocked-flow", {
      "implement-1": {
        id: "implement-1",
        type: "implement",
        promptTemplate: "implement.md.hbs",
        maxAttempts: 1,
        agent: fixtureAgent,
        signals: [],
        transitions: [{ condition: "TESTS_PASS", target: "__done__" }],
      },
    });
    const sessionId = await createSession();

    const response = await sendArmed(sessionId, workflowId, "Do the impossible");
    expect(response.status).toBe(201);

    await waitForPendingWorkflowRuns();

    const run = await ctx.db
      .selectFrom("workflow_runs")
      .selectAll()
      .where("session_id", "=", sessionId)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe("blocked");

    const messages = await listMessages(sessionId);
    expect(messages.at(-1)?.role).toBe("assistant");
    expect(messages.at(-1)?.content).toContain("blocked");
  });

  test("allows a new run after the previous one completes", async () => {
    const workflowId = await twoStepWorkflow();
    const sessionId = await createSession();

    await sendArmed(sessionId, workflowId, "First run");
    await waitForPendingWorkflowRuns();

    const response = await sendArmed(sessionId, workflowId, "Second run");
    expect(response.status).toBe(201);
    await waitForPendingWorkflowRuns();

    const runs = await ctx.db
      .selectFrom("workflow_runs")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at")
      .execute();
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "done")).toBe(true);
  });
});
