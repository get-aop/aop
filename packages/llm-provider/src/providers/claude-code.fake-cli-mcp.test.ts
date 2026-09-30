import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  createFakeCliSandbox,
  FAKE_CLI_PATH,
  readEvents,
  readLog,
} from "../../test-fixtures/test-utils";
import { extractFinalAssistantTextFromRawJsonl } from "../logs";
import type { RunOptions } from "../types";
import { ClaudeCodeProvider } from "./claude-code";

// The real adapter builds the argv (isolation, --mcp-config, --allowedTools, --tools), the real
// fake process parses it, and its MCP calls land on a real HTTP endpoint. Nothing about the
// endpoint is faked except that it is a small stand-in for the AOP server.

interface ReceivedCall {
  name: string;
  args: Record<string, unknown>;
  query: { sessionId: string | null; accessToken: string | null };
  /** The run log when the call arrived: what the fake had written before making the call. */
  logAtCall: string;
}

const TOOLS = ["thread_spawn", "aop_ask_user", "aop_report_status"];

const servers: Array<ReturnType<typeof Bun.serve>> = [];
const sandboxes: Array<{ cleanup: () => void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});
afterAll(() => {
  for (const sandbox of sandboxes) sandbox.cleanup();
});

const startAop = (logPath: () => string) => {
  const calls: ReceivedCall[] = [];
  const methods: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = (await request.json()) as {
        id?: number;
        method: string;
        params?: { name: string; arguments: Record<string, unknown> };
      };
      methods.push(body.method);
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize") return reply({ protocolVersion: "2024-11-05" });
      if (body.method === "tools/list") return reply({ tools: TOOLS.map((name) => ({ name })) });
      const query = new URL(request.url).searchParams;
      calls.push({
        name: body.params?.name ?? "",
        args: body.params?.arguments ?? {},
        query: { sessionId: query.get("sessionId"), accessToken: query.get("accessToken") },
        logAtCall: readLog(logPath()),
      });
      return reply({ content: [{ type: "text", text: `done: ${body.params?.name}` }] });
    },
  });
  servers.push(server);
  const url = `http://127.0.0.1:${server.port}/api/mcp?sessionId=isess_1&accessToken=secret`;
  return { url, calls, methods };
};

const runAgainstAop = async (prompt: string, options: Partial<RunOptions> = {}) => {
  const sandbox = createFakeCliSandbox();
  sandboxes.push(sandbox);
  const logPath = sandbox.logPath("run");
  const aop = startAop(() => logPath);
  const provider = new ClaudeCodeProvider();
  const runOptions: RunOptions = {
    prompt,
    cwd: sandbox.dir,
    runtimeAlias: FAKE_CLI_PATH,
    logFilePath: logPath,
    model: "fake-model",
    reasoningEffort: "low",
    mcpServerUrl: aop.url,
    env: { FAKE_CLI_HOME: sandbox.home },
    ...options,
  };
  const result = await provider.run(runOptions);
  const log = readLog(logPath);
  return { aop, result, log, events: readEvents(logPath), argv: provider.buildCommand(runOptions) };
};

const finalText = (log: string): string => extractFinalAssistantTextFromRawJsonl(log).text;

const spawnCall = `[fake: calls='[{"name":"thread_spawn","arguments":{"title":"Fix login"}}]']`;

describe("the fake CLI calling the AOP MCP endpoint through the real adapter", () => {
  test("a hermetic coordinator-style run reaches the endpoint with only AOP tools available", async () => {
    const prompt = `spawn it ${spawnCall}`;
    const run = await runAgainstAop(prompt, {
      isolation: "hermetic",
      accessMode: "full-access",
      builtInTools: [],
      allowedTools: ["mcp__aop__thread_spawn"],
    });

    expect(run.result.exitCode).toBe(0);
    expect(run.argv).toContain("--strict-mcp-config");
    expect(run.argv.slice(run.argv.indexOf(prompt))).toEqual([
      prompt,
      "--mcp-config",
      JSON.stringify({ mcpServers: { aop: { type: "http", url: run.aop.url } } }),
      "--allowedTools",
      "mcp__aop__thread_spawn",
      "--tools",
      "",
    ]);
    expect(run.aop.methods).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    expect(run.aop.calls).toHaveLength(1);
    expect(run.aop.calls[0]).toMatchObject({
      name: "thread_spawn",
      args: { title: "Fix login" },
      query: { sessionId: "isess_1", accessToken: "secret" },
    });
    expect(run.log).toContain("done: thread_spawn");
    expect(finalText(run.log)).toContain("You said: spawn it");
  });

  test("the call happens mid-turn: init is already in the log, the result is not", async () => {
    const run = await runAgainstAop(`spawn it ${spawnCall}`, { isolation: "hermetic" });

    const seenByServer = run.aop.calls[0]?.logAtCall ?? "";
    expect(seenByServer).toContain('"subtype":"init"');
    expect(seenByServer).not.toContain("tool_result");
    expect(run.log).toContain("tool_result");
  });

  test("an open thread-style run asks the user through the real aop_ask_user tool and waits", async () => {
    const run = await runAgainstAop('pick one [fake: ask="Which one?" options="a|b"]', {
      isolation: "open",
      accessMode: "auto-accept-edits",
      allowedTools: ["mcp__aop__aop_ask_user", "mcp__aop__aop_report_status"],
      disallowedTools: ["AskUserQuestion"],
    });

    expect(run.result.exitCode).toBe(0);
    expect(run.argv).not.toContain("--strict-mcp-config");
    expect(run.aop.calls).toMatchObject([
      { name: "aop_ask_user", args: { question: "Which one?", options: ["a", "b"] } },
    ]);
    expect(finalText(run.log)).toBe("Waiting on your answer.");
  });

  test("a tool the endpoint does not offer is refused without reaching it", async () => {
    const run = await runAgainstAop(`x [fake: calls='[{"name":"thread_stop","arguments":{}}]']`, {
      isolation: "open",
    });

    expect(run.result.exitCode).toBe(0);
    expect(run.aop.calls).toEqual([]);
    expect(run.log).toContain("No such tool available: mcp__aop__thread_stop");
  });

  test("a run with no MCP server URL sees the call fail as not connected", async () => {
    const run = await runAgainstAop(`x ${spawnCall}`, { mcpServerUrl: undefined });

    expect(run.result.exitCode).toBe(0);
    expect(run.aop.calls).toEqual([]);
    expect(run.log).toContain("MCP server aop is not connected");
  });
});
