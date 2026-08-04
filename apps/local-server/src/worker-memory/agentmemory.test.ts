import { afterEach, describe, expect, test } from "bun:test";
import {
  buildWorkerMemorySessionId,
  createAgentMemoryWorkerMemory,
  formatWorkerMemoryContext,
} from "./agentmemory.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  AOP_WORKER_MEMORY_PROVIDER: process.env.AOP_WORKER_MEMORY_PROVIDER,
  AOP_AGENTMEMORY_URL: process.env.AOP_AGENTMEMORY_URL,
  AOP_AGENTMEMORY_SECRET: process.env.AOP_AGENTMEMORY_SECRET,
};

describe("AgentMemory worker memory", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv();
  });

  test("is disabled unless explicitly configured", async () => {
    const memory = createAgentMemoryWorkerMemory();

    const context = await memory.recall({
      workerId: "worker-1",
      repoId: "repo-1",
      repoPath: "/repo",
      worktreePath: "/worktree",
      taskId: "task-1",
      executionId: "exec-1",
      stepId: "step-1",
      changePath: "docs/tasks/example",
      prompt: "Implement the task",
    });

    expect(context).toBeNull();
  });

  test("starts an agentmemory session and formats recalled context", async () => {
    process.env.AOP_WORKER_MEMORY_PROVIDER = "agentmemory";
    process.env.AOP_AGENTMEMORY_URL = "http://memory.local";
    process.env.AOP_AGENTMEMORY_SECRET = "secret";
    const calls: Array<{ url: string; body: unknown; authorization: string | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (url.endsWith("/agentmemory/session/start")) {
        return jsonResponse({ context: "Project convention: use runtime adapters." });
      }
      return jsonResponse({ context: "Prior decision: task executions are session-scoped." });
    }) as typeof fetch;

    const memory = createAgentMemoryWorkerMemory();
    const context = await memory.recall({
      workerId: "worker-1",
      repoId: "repo-1",
      repoPath: "/repo",
      worktreePath: "/worktree",
      taskId: "task-1",
      executionId: "exec-1",
      stepId: "step-1",
      changePath: "docs/tasks/example",
      prompt: "Implement the task",
    });

    expect(calls.map((call) => call.url)).toEqual([
      "http://memory.local/agentmemory/session/start",
      "http://memory.local/agentmemory/search",
    ]);
    expect(calls[0]?.authorization).toBe("Bearer secret");
    expect(calls[0]?.body).toMatchObject({
      sessionId: "aop-worker-worker-1-exec-1-step-1",
      project: "repo-1",
      cwd: "/worktree",
    });
    expect(calls[1]?.body).toMatchObject({
      project: "repo-1",
      cwd: "/repo",
      format: "compact",
      query: expect.stringContaining("docs/tasks/example"),
    });
    expect(context).toContain("Project convention: use runtime adapters.");
    expect(context).toContain("Prior decision: task executions are session-scoped.");
  });

  test("records completion as an observation and ends the memory session", async () => {
    process.env.AOP_WORKER_MEMORY_PROVIDER = "agentmemory";
    process.env.AOP_AGENTMEMORY_URL = "http://memory.local/";
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return jsonResponse({ success: true });
    }) as typeof fetch;

    const memory = createAgentMemoryWorkerMemory();
    await memory.recordCompletion({
      workerId: "worker-1",
      repoId: "repo-1",
      repoPath: "/repo",
      worktreePath: "/worktree",
      taskId: "task-1",
      executionId: "exec-1",
      stepId: "step-1",
      changePath: "docs/tasks/example",
      stepType: "implement",
      status: "success",
      sessionId: "runtime-session-1",
    });

    expect(calls.map((call) => call.url)).toEqual([
      "http://memory.local/agentmemory/observe",
      "http://memory.local/agentmemory/session/end",
    ]);
    expect(calls[0]?.body).toMatchObject({
      hookType: "AOPStepComplete",
      sessionId: "aop-worker-worker-1-exec-1-step-1",
      project: "repo-1",
      cwd: "/worktree",
      data: {
        workerId: "worker-1",
        taskId: "task-1",
        status: "success",
        runtimeSessionId: "runtime-session-1",
      },
    });
    expect(calls[1]?.body).toEqual({ sessionId: "aop-worker-worker-1-exec-1-step-1" });
  });

  test("uses stable sanitized session ids", () => {
    expect(buildWorkerMemorySessionId("worker:1", "exec/1", "step 1")).toBe(
      "aop-worker-worker-1-exec-1-step-1",
    );
  });

  test("formats memory as heuristic context", () => {
    expect(formatWorkerMemoryContext(["One", "Two"])).toBe(
      [
        "## Worker Memory Context",
        "",
        "Treat this as heuristic context. Verify it against the current repo before acting.",
        "",
        "One",
        "",
        "Two",
      ].join("\n"),
    );
  });
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
