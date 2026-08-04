import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../app.ts";
import type { LocalServerContext } from "../context.ts";
import type { AnyJson } from "../db/test-utils.ts";
import { createTestContext, createTestRepo, createTestTask } from "../db/test-utils.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  AOP_WORKER_MEMORY_PROVIDER: process.env.AOP_WORKER_MEMORY_PROVIDER,
  AOP_AGENTMEMORY_URL: process.env.AOP_AGENTMEMORY_URL,
};

describe("worker memory routes", () => {
  let ctx: LocalServerContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    await ctx.db
      .insertInto("workflows")
      .values({ id: "workflow-1", name: "workflow-1", definition: "{}" })
      .execute();
    await createTestRepo(ctx.db, "repo-1", "/tmp/aop-memory-routes-repo-1");
    await createTestTask(ctx.db, "task-1", "repo-1", "docs/tasks/memory-search", "DRAFT");
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    restoreEnv();
    await ctx.db.destroy();
  });

  test("searches configured AgentMemory for active agents in the requested repo", async () => {
    process.env.AOP_WORKER_MEMORY_PROVIDER = "agentmemory";
    process.env.AOP_AGENTMEMORY_URL = "http://memory.local";
    await createAgent("agent-atlas", "Atlas", "active", "repo-1");
    await createAgent("agent-archived", "Archived", "archived", "repo-1");
    const calls: Array<{ url: string; body: AnyJson }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return jsonResponse({ context: "Atlas remembers the dashboard menu tradeoff." });
    }) as typeof fetch;

    const response = await app().request("/api/agent-memory/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoId: "repo-1",
        taskId: "task-1",
        query: "chat replacement",
      }),
    });

    expect(response.status).toBe(200);
    const body: AnyJson = await response.json();
    expect(body.enabled).toBe(true);
    expect(body.results).toEqual([
      {
        agentId: "agent-atlas",
        agentName: "Atlas",
        repoId: "repo-1",
        repoName: "aop-memory-routes-repo-1",
        snippet: "Atlas remembers the dashboard menu tradeoff.",
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://memory.local/agentmemory/search");
    const searchBody = calls[0]?.body as { query?: string };
    const searchQuery = searchBody.query;
    expect(calls[0]?.body).toMatchObject({
      project: "repo-1",
      format: "compact",
      limit: 5,
    });
    expect(searchQuery).toEqual(expect.stringContaining("Worker: agent-atlas"));
    expect(searchQuery).toEqual(expect.stringContaining("Task: task-1"));
    expect(searchQuery).toEqual(expect.stringContaining("Change path: docs/tasks/memory-search"));
    expect(searchQuery).toEqual(expect.stringContaining("chat replacement"));
  });

  test("returns a disabled response without calling AgentMemory when not configured", async () => {
    await createAgent("agent-atlas", "Atlas", "active", "repo-1");
    globalThis.fetch = (async () => {
      throw new Error("AgentMemory should not be called when disabled");
    }) as unknown as typeof fetch;

    const response = await app().request("/api/agent-memory/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: "repo-1", query: "anything" }),
    });

    expect(response.status).toBe(200);
    const body: AnyJson = await response.json();
    expect(body).toEqual({
      enabled: false,
      results: [],
    });
  });

  const app = () => createApp({ ctx, startTimeMs: Date.now() });

  const createAgent = async (
    id: string,
    name: string,
    status: "active" | "archived",
    repoId: string,
  ) => {
    await ctx.db
      .insertInto("agents")
      .values({
        id,
        name,
        role: "developer",
        runtime_provider: "codex-cli",
        provider: "codex-cli",
        model: "gpt-5.4",
        workflow_id: "workflow-1",
        status,
        artifact_path: `/tmp/.aop/agents/${id}`,
        source_kind: "codex-cli-worker-profile",
        source_ref: null,
      })
      .execute();
    await ctx.db
      .insertInto("agent_repo_memberships")
      .values({ agent_id: id, repo_id: repoId, membership_role: "primary" })
      .execute();
  };
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const restoreEnv = () => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};
