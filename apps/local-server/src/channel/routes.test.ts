import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import { createChannelRoutes } from "./routes.ts";

describe("channel/routes", () => {
  let cleanupAopHome: () => void;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;
  let deliverFollowUp: ReturnType<typeof mock>;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    deliverFollowUp = mock(() => Promise.resolve());
    app = new Hono();
    app.route("/api/channels", createChannelRoutes(ctx, { deliverFollowUp }));
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("GET /api/channels/factory returns a group channel with active worker memberships", async () => {
    await seedPrivateChannel(ctx, { channelId: "private-a", agentId: "agent-a" });
    await seedAgent(ctx, "agent-b");

    const response = await app.request("/api/channels/factory");
    const body: AnyJson = await response.json();

    expect(response.status).toBe(200);
    expect(body.channel).toEqual(
      expect.objectContaining({
        kind: "group",
        name: "Factory floor",
      }),
    );

    const memberships = await ctx.channelRepository.listMemberships(body.channel.id as string);
    expect(memberships.map((membership) => membership.agent_id).sort()).toEqual([
      "agent-a",
      "agent-b",
    ]);

    const secondResponse = await app.request("/api/channels/factory");
    const secondBody: AnyJson = await secondResponse.json();
    expect(secondBody.channel.id).toBe(body.channel.id);
  });

  test("GET /api/channels/factory keeps one history channel under concurrent first loads", async () => {
    await seedPrivateChannel(ctx, { channelId: "private-a", agentId: "agent-a" });

    const responses = await Promise.all([
      app.request("/api/channels/factory"),
      app.request("/api/channels/factory"),
      app.request("/api/channels/factory"),
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json() as Promise<AnyJson>),
    );
    const channels = await ctx.db
      .selectFrom("channels")
      .selectAll()
      .where("kind", "=", "group")
      .where("name", "=", "Factory floor")
      .execute();

    expect(new Set(bodies.map((body) => body.channel.id)).size).toBe(1);
    expect(channels).toHaveLength(1);
  });

  test("GET /api/channels/:channelId/messages returns ordered channel messages", async () => {
    await seedPrivateChannel(ctx, { channelId: "chan-1" });
    await ctx.channelRepository.createMessage({
      id: "msg-1",
      channel_id: "chan-1",
      author_type: "user",
      author_agent_id: null,
      content: "first",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    await ctx.channelRepository.createMessage({
      id: "msg-2",
      channel_id: "chan-1",
      author_type: "system",
      author_agent_id: null,
      content: "second",
      created_at: "2026-01-01T00:00:01.000Z",
    });

    const response = await app.request("/api/channels/chan-1/messages");
    const body: AnyJson = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toEqual([
      expect.objectContaining({ id: "msg-1", channelId: "chan-1", authorType: "user" }),
      expect.objectContaining({ id: "msg-2", channelId: "chan-1", authorType: "system" }),
    ]);
  });

  test("POST /api/channels/:channelId/messages persists a user message without an active session", async () => {
    await seedPrivateChannel(ctx, { channelId: "chan-1" });

    const response = await app.request("/api/channels/chan-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Please check this" }),
    });
    const body: AnyJson = await response.json();

    expect(response.status).toBe(201);
    expect(body.message).toEqual(
      expect.objectContaining({
        channelId: "chan-1",
        authorType: "user",
        content: "Please check this",
      }),
    );
    expect(deliverFollowUp).not.toHaveBeenCalled();
  });

  test("POST /api/channels/:channelId/messages delivers a follow-up to the active Pi session", async () => {
    await seedPrivateChannel(ctx, { channelId: "chan-1", agentId: "agent-pi" });
    await createTestTask(db, "task-1", "repo-1", "changes/feat", "WORKING");
    await ctx.taskAssignmentRepository.upsertCurrent({
      taskId: "task-1",
      agentId: "agent-pi",
      repoId: "repo-1",
      statusColumn: "IN_PROGRESS",
    });
    await ctx.executionRepository.createExecution({
      id: "exec-1",
      task_id: "task-1",
      status: "running",
      started_at: "2026-01-01T00:00:00.000Z",
    });
    await ctx.executionRepository.createStepExecution({
      id: "step-1",
      execution_id: "exec-1",
      status: "running",
      session_id: "pi-session-1",
      started_at: "2026-01-01T00:00:00.000Z",
    });

    const response = await app.request("/api/channels/chan-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Continue with narrower scope" }),
    });

    expect(response.status).toBe(201);
    expect(deliverFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-pi",
        channelId: "chan-1",
        sessionId: "pi-session-1",
        message: "Continue with narrower scope",
        taskId: "task-1",
        stepExecutionId: "step-1",
      }),
    );
  });

  test("POST /api/channels/:channelId/messages delivers a group message to active Pi members", async () => {
    await seedPrivateChannel(ctx, { channelId: "private-seed", agentId: "agent-a" });
    await seedAgent(ctx, "agent-b");
    await ctx.channelRepository.create({
      id: "chan-group",
      repo_id: "repo-1",
      owner_agent_id: null,
      kind: "group",
      name: "Factory group",
      artifact_path: "/tmp/aop/chats/group/chan-group",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    await ctx.channelRepository.createMembership({
      channel_id: "chan-group",
      agent_id: "agent-a",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    await ctx.channelRepository.createMembership({
      channel_id: "chan-group",
      agent_id: "agent-b",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    await seedActiveSession(ctx, "agent-a", "task-a", "exec-a", "step-a", "pi-session-a");
    await seedActiveSession(ctx, "agent-b", "task-b", "exec-b", "step-b", "pi-session-b");

    const response = await app.request("/api/channels/chan-group/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Factory update" }),
    });

    expect(response.status).toBe(201);
    expect(deliverFollowUp).toHaveBeenCalledTimes(2);
    expect(deliverFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-a", sessionId: "pi-session-a" }),
    );
    expect(deliverFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-b", sessionId: "pi-session-b" }),
    );
  });

  test("POST /api/channels/:channelId/messages rejects blank content", async () => {
    await seedPrivateChannel(ctx, { channelId: "chan-1" });

    const response = await app.request("/api/channels/chan-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });
    const body: AnyJson = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Message content is required");
  });
});

const seedPrivateChannel = async (
  ctx: LocalServerContext,
  options: { channelId: string; agentId?: string; runtimeProvider?: "pi" },
) => {
  const agentId = options.agentId ?? "agent-1";
  await ctx.db
    .insertInto("workflows")
    .values({ id: "workflow-1", name: "workflow-1", definition: "{}" })
    .execute();
  await createTestRepo(ctx.db, "repo-1", "/tmp/aop-channel-routes-repo");
  await seedAgent(ctx, agentId, options.runtimeProvider ?? "pi");
  await ctx.channelRepository.create({
    id: options.channelId,
    repo_id: null,
    owner_agent_id: agentId,
    kind: "private",
    name: `${agentId} private`,
    artifact_path: `/tmp/aop/agents/${agentId}/chats/private/${options.channelId}`,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  await ctx.channelRepository.createMembership({
    channel_id: options.channelId,
    agent_id: agentId,
    created_at: "2026-01-01T00:00:00.000Z",
  });
};

const seedAgent = async (
  ctx: LocalServerContext,
  agentId: string,
  runtimeProvider: "pi" = "pi",
): Promise<void> => {
  await ctx.db
    .insertInto("agents")
    .values({
      id: agentId,
      name: agentId,
      role: "developer",
      runtime_provider: runtimeProvider,
      provider: runtimeProvider,
      model: "default",
      workflow_id: "workflow-1",
      status: "active",
      artifact_path: `/tmp/aop/agents/${agentId}`,
      source_kind: `${runtimeProvider}-worker-profile`,
      source_ref: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    })
    .execute();
};

const seedActiveSession = async (
  ctx: LocalServerContext,
  agentId: string,
  taskId: string,
  executionId: string,
  stepId: string,
  sessionId: string,
): Promise<void> => {
  await ctx.taskAssignmentRepository.upsertCurrent({
    taskId,
    agentId,
    repoId: "repo-1",
    statusColumn: "IN_PROGRESS",
  });
  await ctx.executionRepository.createExecution({
    id: executionId,
    task_id: taskId,
    status: "running",
    started_at: "2026-01-01T00:00:00.000Z",
  });
  await ctx.executionRepository.createStepExecution({
    id: stepId,
    execution_id: executionId,
    status: "running",
    session_id: sessionId,
    started_at: "2026-01-01T00:00:00.000Z",
  });
};
