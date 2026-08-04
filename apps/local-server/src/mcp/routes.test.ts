import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createTestContext, createTestRepo } from "../db/test-utils.ts";
import { createAuthenticatedMcpUrl } from "./auth.ts";
import { createMcpRoutes } from "./routes.ts";

describe("MCP HTTP routes", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  test("rejects unsigned MCP protocol requests", async () => {
    const ctx = await createTestContext();
    cleanup = async () => {
      await ctx.db.destroy();
    };
    const app = new Hono().route("/mcp", createMcpRoutes(ctx));

    const response = await app.request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const toolsResponse = await app.request("http://localhost/mcp/tools");

    expect(response.status).toBe(401);
    expect(toolsResponse.status).toBe(401);
  });

  test("tools/list and tools/call serve the surviving tool set", async () => {
    const ctx = await createTestContext();
    cleanup = async () => {
      await ctx.db.destroy();
    };
    await createTestRepo(ctx.db, "repo-route-1", "route-repo");
    await createChatSession(ctx, "isess_mcp_create", "repo-route-1");

    const app = new Hono();
    app.route("/mcp", createMcpRoutes(ctx));

    const listed = await app.request(
      createAuthenticatedMcpUrl("http://localhost/mcp", "isess_mcp_create"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listBody.result.tools.some((tool) => tool.name === "aop_list_workflows")).toBe(true);
    expect(listBody.result.tools.some((tool) => tool.name === "aop_create_task")).toBe(false);

    const toolsResponse = await app.request(
      createAuthenticatedMcpUrl("http://localhost/mcp/tools", "isess_mcp_create"),
    );
    expect(toolsResponse.status).toBe(200);

    const call = await app.request(
      createAuthenticatedMcpUrl("http://localhost/mcp", "isess_mcp_create"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "aop_list_repos", arguments: {} },
        }),
      },
    );
    expect(call.status).toBe(200);
    const callBody = (await call.json()) as {
      result: { content: { repos: Array<{ id: string }> }; isProposal: boolean };
    };
    expect(callBody.result.content.repos.some((repo) => repo.id === "repo-route-1")).toBe(true);
    expect(callBody.result.isProposal).toBe(false);
  });

  test("rejects an access token bound to a different session", async () => {
    const ctx = await createTestContext();
    cleanup = async () => {
      await ctx.db.destroy();
    };
    await createTestRepo(ctx.db, "repo-route-no-session", "route-repo-no-session");
    const app = new Hono().route("/mcp", createMcpRoutes(ctx));

    const forgedUrl = new URL(createAuthenticatedMcpUrl("http://localhost/mcp", "isess_original"));
    forgedUrl.searchParams.set("sessionId", "isess_forged");

    const response = await app.request(forgedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "aop_create_task",
          arguments: {
            title: "From MCP with forged session",
            description: "Body",
            repoId: "repo-route-no-session",
            planMarkdown: "## Plan\n\n- [ ] Body",
          },
        },
      }),
    });

    expect(response.status).toBe(401);
    const tasks = await ctx.taskRepository.list({ repo_id: "repo-route-no-session" });
    expect(tasks).toHaveLength(0);
  });

  test("notifications/initialized returns 202 and unknown methods return JSON-RPC on HTTP 200", async () => {
    const ctx = await createTestContext();
    cleanup = async () => {
      await ctx.db.destroy();
    };
    const app = new Hono();
    app.route("/mcp", createMcpRoutes(ctx));

    const mcpUrl = createAuthenticatedMcpUrl("http://localhost/mcp", "isess_protocol");
    const initialized = await app.request(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(initialized.status).toBe(202);

    const unknown = await app.request(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/nope" }),
    });
    expect(unknown.status).toBe(200);
    const body = (await unknown.json()) as {
      error: { code: number; message: string };
    };
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain("Method not found");
  });
});

const createChatSession = async (
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  id: string,
  repoId: string,
) => {
  const now = new Date().toISOString();
  await ctx.chatSessionRepository.create({
    id,
    repo_id: repoId,
    title: "MCP task creation",
    named: false,
    runtime: "claude-code",
    runtime_configuration_id: null,
    model: "claude-opus-4-8",
    reasoning_effort: "medium",
    runtime_alias: null,
    runtime_session_id: null,
    workspace_path: null,
    fast_mode: false,
    default_worker_id: null,
    default_workflow_id: null,
    pinned: false,
    settled_override: null,
    settled_at: null,
    created_at: now,
    updated_at: now,
  });
};
