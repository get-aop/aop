import { afterEach, describe, expect, test } from "bun:test";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import type { ChatSession } from "../db/schema.ts";
import {
  createProjectStack,
  insertProjectSession,
  type ProjectStack,
  projectSettings,
  useTempAopHome,
} from "../project/test-utils.ts";
import { coordinatorInbox } from "../thread/test-utils.ts";
import { createAuthenticatedMcpUrl, rotateMcpSecret } from "./auth.ts";
import { forgetMcpSecret } from "./secret.ts";

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path());
  stack = s;
  const created = await s.services.projects.create(
    projectSettings({ repoIds: s.repos.map((repo) => repo.id) }),
  );
  if (!created.success) throw new Error("project not created");
  const coordinator = (await s.ctx.chatSessionRepository.getCoordinator(
    created.project.id,
  )) as ChatSession;
  return { s, project: created.project, coordinator };
};

const toolNames = async (s: ProjectStack, sessionId: string): Promise<string[]> => {
  const { body } = await s.mcp(sessionId, "tools/list");
  return (body.result?.tools ?? []).map((tool) => tool.name).sort();
};

const plainSession = async (s: ProjectStack): Promise<string> => {
  const now = new Date().toISOString();
  const session = await s.ctx.chatSessionRepository.create({
    id: "isess_plain",
    repo_id: s.repos[0]?.id ?? null,
    title: "Plain chat",
    runtime: "claude-code",
    runtime_configuration_id: null,
    model: "fake-model",
    reasoning_effort: "medium",
    runtime_alias: null,
    runtime_session_id: null,
    workspace_path: null,
    created_at: now,
    updated_at: now,
  });
  return session.id;
};

describe("MCP HTTP routes", () => {
  test("rejects unsigned requests, tool discovery included", async () => {
    const { s } = await setup();

    const rpc = await s.app.request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const listing = await s.app.request("http://localhost/api/mcp/tools");

    expect(rpc.status).toBe(401);
    expect(listing.status).toBe(401);
  });

  test("rejects a token signed for a different session", async () => {
    const { s, coordinator } = await setup();
    const forged = new URL(createAuthenticatedMcpUrl("http://localhost/api/mcp", "isess_original"));
    forged.searchParams.set("sessionId", coordinator.id);

    const response = await s.app.request(forged, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(response.status).toBe(401);
  });

  test("rejects a correctly signed URL whose session no longer exists", async () => {
    const { s } = await setup();

    const { status } = await s.mcp("isess_deleted", "tools/list");

    expect(status).toBe(401);
  });

  test("answers initialize, accepts notifications/initialized, and reports unknown methods as JSON-RPC errors", async () => {
    const { s, coordinator } = await setup();

    const initialized = await s.mcp(coordinator.id, "initialize");
    expect(initialized.body).toMatchObject({ result: { serverInfo: { name: "aop" } } });

    const url = createAuthenticatedMcpUrl("http://localhost/api/mcp", coordinator.id);
    const notification = await s.app.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(notification.status).toBe(202);

    const unknown = await s.mcp(coordinator.id, "tools/nope");
    expect(unknown.status).toBe(200);
    expect(unknown.body.error).toMatchObject({ code: -32601 });
  });

  test("offers each kind of session its own tools", async () => {
    const { s, project, coordinator } = await setup();
    const spawned = await s.services.threads.spawn(project.id, { prompt: "work" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    expect(await toolNames(s, coordinator.id)).toEqual([
      "aop_artifact_create",
      "aop_artifact_update",
      "aop_library_list",
      "aop_library_read",
      "aop_library_save",
      "memory_delete",
      "memory_read",
      "memory_write",
      "project_settings_get",
      "project_settings_set",
      "propose_threads",
      "routine_create",
      "routine_delete",
      "routine_list",
      "routine_pause",
      "routine_run_now",
      "routine_update",
      "thread_list",
      "thread_merge_pr",
      "thread_open_pr",
      "thread_report",
      "thread_resolve",
      "thread_spawn",
      "thread_steer",
      "thread_stop",
    ]);
    expect(await toolNames(s, spawned.thread.id)).toEqual([
      "aop_artifact_create",
      "aop_artifact_update",
      "aop_ask_user",
      "aop_library_list",
      "aop_library_read",
      "aop_library_save",
      "aop_open_pr",
      "aop_propose_routine",
      "aop_report_status",
      "memory_read",
      "memory_write",
    ]);
    expect(await toolNames(s, await plainSession(s))).toEqual([
      "aop_list_repos",
      "aop_set_chat_workspace",
    ]);
  });

  test("advertises each tool with a JSON Schema for its arguments", async () => {
    const { s, coordinator } = await setup();

    const { body } = await s.mcp(coordinator.id, "tools/list");

    for (const tool of body.result?.tools ?? []) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.inputSchema).not.toHaveProperty("$schema");
    }
    const spawn = body.result?.tools?.find((tool) => tool.name === "thread_spawn");
    expect(spawn?.inputSchema).toMatchObject({ required: ["prompt"] });
  });

  test("a tool result is an array of content blocks, never a bare object", async () => {
    const { s } = await setup();
    const sessionId = await plainSession(s);

    const result = await s.callTool(sessionId, "aop_list_repos");

    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]?.type).toBe("text");
    const listed = JSON.parse(result.content[0]?.text ?? "{}") as { repos: { id: string }[] };
    expect(listed.repos.map((repo) => repo.id)).toEqual(s.repos.map((repo) => repo.id));
    expect(result).not.toHaveProperty("isProposal");
  });

  test("a tool the session is not offered is an unknown tool, not a result", async () => {
    const { s, project, coordinator } = await setup();
    const spawned = await s.services.threads.spawn(project.id, { prompt: "work" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const threadCallsSpawn = await s.mcp(spawned.thread.id, "tools/call", {
      name: "thread_spawn",
      arguments: { prompt: "a thread starting threads" },
    });
    const coordinatorAsks = await s.mcp(coordinator.id, "tools/call", {
      name: "aop_ask_user",
      arguments: { question: "?" },
    });

    expect(threadCallsSpawn.body.error).toMatchObject({ code: -32602 });
    expect(coordinatorAsks.body.error).toMatchObject({ code: -32602 });
    expect(await s.services.threads.list(project.id)).toMatchObject({
      threads: [{ id: spawned.thread.id }],
    });
  });

  test("bad arguments and refused actions come back as an error result the model can read", async () => {
    const { s, coordinator } = await setup();

    const missing = await s.callTool(coordinator.id, "thread_spawn", {});
    const unknownThread = await s.callTool(coordinator.id, "thread_steer", {
      threadId: "isess_nope",
      message: "hi",
    });

    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain("prompt");
    expect(unknownThread.isError).toBe(true);
    expect(unknownThread.content[0]?.text).toContain("Thread not found");
  });
});

const listTools = (s: ProjectStack, url: string) =>
  s.app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

describe("MCP access across host restarts", () => {
  test("a token issued before the host restarted still works", async () => {
    const { s, coordinator } = await setup();
    const url = createAuthenticatedMcpUrl("http://localhost/api/mcp", coordinator.id);

    // A new host process holds no secret; it reads the one the old process kept.
    forgetMcpSecret();
    const response = await listTools(s, url);

    expect(response.status).toBe(200);
  });

  test("a resolved thread's token no longer works", async () => {
    const { s, project } = await setup();
    await insertProjectSession(
      s.db,
      { id: "isess_done", projectId: project.id, kind: "thread" },
      { state: "resolved", resolved_at: "2026-09-30T10:00:00.000Z" },
    );

    const { status } = await s.mcp("isess_done", "tools/list");

    expect(status).toBe(401);
  });

  test("tells a client that opens a stream for server messages that there is none", async () => {
    const { s, coordinator } = await setup();
    const url = createAuthenticatedMcpUrl("http://localhost/api/mcp", coordinator.id);

    const response = await s.app.request(url, { headers: { Accept: "text/event-stream" } });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  test("a working thread whose token went stale is marked degraded and reported; its next call clears it", async () => {
    const { s, project } = await setup();
    await insertProjectSession(s.db, { id: "isess_busy", projectId: project.id, kind: "thread" });
    const staleUrl = createAuthenticatedMcpUrl("http://localhost/api/mcp", "isess_busy");

    rotateMcpSecret();
    const refused = await listTools(s, staleUrl);

    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining("MCP secret") });
    const degraded = await s.services.threads.get("isess_busy");
    expect(
      degraded.success && degraded.thread.status === "working" && degraded.thread.degraded,
    ).toMatchObject({ reason: expect.stringContaining("refused its AOP tool token") });
    const [report] = await coordinatorInbox(s, project.id);
    expect(report?.content).toStartWith(
      'Thread report: "isess_busy" (isess_busy) lost its AOP tools.',
    );
    expect(parseMessageOrigin(report?.origin_json ?? null)).toMatchObject({ outcome: "needs-you" });

    // A second refusal of the same turn tells nobody again.
    await listTools(s, staleUrl);
    expect(await coordinatorInbox(s, project.id)).toHaveLength(1);

    const fresh = await s.mcp("isess_busy", "tools/list");
    expect(fresh.status).toBe(200);
    const cleared = await s.services.threads.get("isess_busy");
    expect(
      cleared.success && cleared.thread.status === "working" && cleared.thread.degraded,
    ).toBeUndefined();
  });

  test("a token of the wrong shape marks nothing", async () => {
    const { s, project } = await setup();
    await insertProjectSession(s.db, { id: "isess_busy", projectId: project.id, kind: "thread" });

    await listTools(s, "http://localhost/api/mcp?sessionId=isess_busy&accessToken=guess");

    const thread = await s.services.threads.get("isess_busy");
    expect(
      thread.success && thread.thread.status === "working" && thread.thread.degraded,
    ).toBeUndefined();
  });
});
