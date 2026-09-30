import { describe, expect, test } from "bun:test";
import { ClaudeCodeProvider } from "../../src/providers/claude-code";
import { claudeDialect } from "./claude";
import type { JsonLine, TurnContext } from "./types";

const ctx: TurnContext = {
  sessionId: "sess-1",
  cwd: "/work",
  usage: { input: 1000, output: 200, cacheWrite: 3000, cacheRead: 50_000 },
  prompt: "hi",
  turn: 1,
  resumed: false,
};

describe("claudeDialect.parse", () => {
  test("recovers prompt, resume id and model from the argv the real adapter builds", () => {
    const [, ...args] = new ClaudeCodeProvider().buildCommand({
      prompt: "do the thing",
      runtimeAlias: "/fake/claude",
      resumeSessionId: "sess-1",
      model: "opus",
      reasoningEffort: "high",
      isolation: "open",
      mcpServerUrl: "http://127.0.0.1:1/mcp",
      disallowedTools: ["Bash", "Edit"],
      allowedDirectories: ["/a", "/b"],
      allowedTools: ["mcp__aop__aop_ask_user", "mcp__aop__aop_report_status"],
      builtInTools: [],
      fastMode: true,
      accessMode: "auto",
    });

    expect(claudeDialect.matches(args)).toBe(true);
    expect(claudeDialect.parse(args)).toEqual({
      prompt: "do the thing",
      resumeId: "sess-1",
      model: "opus",
      mcpServers: { aop: { url: "http://127.0.0.1:1/mcp" } },
    });
  });

  test("keeps the prompt when the variadic tool flags are the last ones", () => {
    const [, ...args] = new ClaudeCodeProvider().buildCommand({
      prompt: "no model given",
      allowedTools: ["mcp__aop__thread_list"],
      builtInTools: ["Read"],
    });

    expect(claudeDialect.parse(args).prompt).toBe("no model given");
  });

  test("a variadic --mcp-config swallows an unbounded prompt like the real parser", () => {
    const args = ["--output-format", "stream-json", "--mcp-config", "{}", "the prompt"];

    expect(claudeDialect.parse(args).prompt).toBe("");
  });

  test("handles the hermetic defaults of a first turn", () => {
    const [, ...args] = new ClaudeCodeProvider().buildCommand({ prompt: "first turn" });

    expect(claudeDialect.parse(args)).toEqual({
      prompt: "first turn",
      resumeId: undefined,
      model: undefined,
      mcpServers: {},
    });
  });

  test("reads only HTTP servers from every --mcp-config value and ignores broken JSON", () => {
    const config = (servers: Record<string, unknown>): string =>
      JSON.stringify({ mcpServers: servers });
    const args = [
      "--output-format",
      "stream-json",
      "--mcp-config",
      config({
        aop: { type: "http", url: "http://127.0.0.1:9/api/mcp?sessionId=s" },
        playwright: { type: "stdio", command: "bunx" },
      }),
      "not json",
      config({ other: { type: "http", url: "http://127.0.0.1:8/mcp" }, odd: { type: "http" } }),
      "--model",
      "m",
      "prompt",
    ];

    expect(claudeDialect.parse(args).mcpServers).toEqual({
      aop: { url: "http://127.0.0.1:9/api/mcp?sessionId=s" },
      other: { url: "http://127.0.0.1:8/mcp" },
    });
  });

  test("does not claim argv that lacks the stream-json output flag", () => {
    expect(claudeDialect.matches(["exec", "--json", "prompt"])).toBe(false);
  });
});

const contentOf = (line: JsonLine | undefined): Array<Record<string, unknown>> => {
  const message = line?.message as { content: Array<Record<string, unknown>> } | undefined;
  return message?.content ?? [];
};

describe("claudeDialect events", () => {
  test("stamps every event with the session id, as Claude's stream-json does", () => {
    const lines = [
      ...claudeDialect.start(ctx),
      ...claudeDialect.beat({ kind: "shell", command: "ls", output: "a" }, 0, ctx),
      ...claudeDialect.beat({ kind: "text", text: "ok" }, 1, ctx),
      ...claudeDialect.end({ kind: "success", text: "done" }, ctx),
    ];

    expect(lines.map((line) => line.session_id)).toEqual(lines.map(() => "sess-1"));
  });

  test("pairs a tool call with a result that references its id", () => {
    const [call, result] = claudeDialect.beat(
      { kind: "shell", command: "ls", output: "a" },
      4,
      ctx,
    );

    const [toolUse] = contentOf(call);
    const [toolResult] = contentOf(result);
    expect(toolUse).toMatchObject({ type: "tool_use", name: "Bash", input: { command: "ls" } });
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: toolUse?.id });
  });

  test("names an MCP question tool mcp__aop__<tool> unless it is already qualified", () => {
    const toolName = (tool: string): unknown => {
      const [call] = claudeDialect.beat(
        { kind: "ask", ask: { question: "q", options: [], tool } },
        0,
        ctx,
      );
      return contentOf(call)[0]?.name;
    };

    expect(toolName("aop_ask_user")).toBe("mcp__aop__aop_ask_user");
    expect(toolName("mcp__other__ask")).toBe("mcp__other__ask");
  });

  test("an MCP beat is a mcp__aop__<tool> call paired with the result the server gave", () => {
    const beat = (isError: boolean) =>
      claudeDialect.beat(
        {
          kind: "mcp",
          call: { name: "thread_spawn", arguments: { title: "Fix login" } },
          result: { text: '{"threadId":"t1"}', isError },
        },
        2,
        ctx,
      );

    const [call, ok] = beat(false);
    const [, failed] = beat(true);

    expect(contentOf(call)[0]).toMatchObject({
      type: "tool_use",
      name: "mcp__aop__thread_spawn",
      input: { title: "Fix login" },
    });
    expect(contentOf(ok)[0]).toMatchObject({
      type: "tool_result",
      content: '{"threadId":"t1"}',
      is_error: false,
    });
    expect(contentOf(failed)[0]).toMatchObject({ is_error: true });
  });

  test("a silent ending emits no terminal event", () => {
    expect(claudeDialect.end({ kind: "silent" }, ctx)).toEqual([]);
  });
});

describe("claudeDialect usage", () => {
  const modelCtx: TurnContext = { ...ctx, model: "fake-model" };

  test("the result reports the turn's tokens per model, with a cost derived from them", () => {
    const result = claudeDialect.end({ kind: "success", text: "done" }, modelCtx).at(-1);

    // 1000 * $15 + 200 * $75 + 3000 * $18.75 + 50000 * $1.50, per million tokens.
    const cost = 0.161_25;
    expect(result).toMatchObject({
      type: "result",
      total_cost_usd: cost,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 50_000,
      },
      modelUsage: {
        "fake-model": {
          inputTokens: 1000,
          outputTokens: 200,
          cacheCreationInputTokens: 3000,
          cacheReadInputTokens: 50_000,
          costUSD: cost,
        },
      },
    });
  });

  test("a failed turn still reports usage, as Claude does", () => {
    const [result] = claudeDialect.end({ kind: "failure", message: "boom" }, ctx);

    expect(result).toMatchObject({ is_error: true, usage: { input_tokens: 1000 } });
  });

  test("assistant events carry the same usage under one message id", () => {
    const events = [
      ...claudeDialect.beat({ kind: "text", text: "a" }, 0, ctx),
      ...claudeDialect.beat({ kind: "shell", command: "ls", output: "x" }, 1, ctx),
    ].filter((line) => line.type === "assistant");

    const messages = events.map((line) => line.message as Record<string, unknown>);
    expect(new Set(messages.map((message) => message.id)).size).toBe(1);
    expect(messages.every((message) => message.usage !== undefined)).toBe(true);
  });
});
