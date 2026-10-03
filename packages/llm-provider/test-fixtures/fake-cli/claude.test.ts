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
      effort: "high",
      flags: [
        "--output-format",
        "--verbose",
        "--permission-mode",
        "--resume",
        "--settings",
        "--model",
        "--effort",
        "--mcp-config",
        "--disallowedTools",
        "--add-dir",
        "--allowedTools",
        "--tools",
      ],
      recordSystemPrompt: true,
      mcpServers: { aop: { url: "http://127.0.0.1:1/mcp" } },
    });
  });

  test("a run on Claude Code's own default names no model and no effort, and still finds its prompt", () => {
    const [, ...args] = new ClaudeCodeProvider().buildCommand({
      prompt: "the prompt",
      isolation: "hermetic",
      accessMode: "approval-required",
      mcpServerUrl: "http://127.0.0.1:1/mcp",
      disallowedTools: ["AskUserQuestion"],
      allowedTools: ["mcp__aop__thread_spawn"],
      builtInTools: [],
    });

    const invocation = claudeDialect.parse(args);

    expect(invocation.prompt).toBe("the prompt");
    expect(invocation.model).toBeUndefined();
    expect(invocation.effort).toBeUndefined();
    expect(invocation.flags).not.toContain("--model");
    expect(invocation.flags).not.toContain("--effort");
    expect(invocation.mcpServers).toEqual({ aop: { url: "http://127.0.0.1:1/mcp" } });
  });

  test("recovers the appended system prompt and the snapshot switch the adapter sends", () => {
    const [, ...args] = new ClaudeCodeProvider().buildCommand({
      prompt: "the prompt",
      appendSystemPrompt: "# Brief\n--- not a flag",
      isolation: "hermetic",
      mcpServerUrl: "http://127.0.0.1:1/mcp",
      disallowedTools: ["AskUserQuestion"],
    });

    expect(claudeDialect.parse(args)).toMatchObject({
      prompt: "the prompt",
      appendSystemPrompt: "# Brief\n--- not a flag",
      recordSystemPrompt: false,
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
      effort: undefined,
      flags: [
        "--setting-sources",
        "--strict-mcp-config",
        "--output-format",
        "--verbose",
        "--dangerously-skip-permissions",
      ],
      appendSystemPrompt: undefined,
      recordSystemPrompt: true,
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

  test("a scripted tool call is a tool_use under its full name, answered ok", () => {
    const [call, result] = claudeDialect.beat(
      { kind: "tool", name: "mcp__cua-driver__click" },
      2,
      ctx,
    );

    expect(contentOf(call)[0]).toMatchObject({ type: "tool_use", name: "mcp__cua-driver__click" });
    expect(contentOf(result)[0]).toMatchObject({ type: "tool_result", content: "ok" });
  });

  test("with partial messages, a block opens, grows in deltas, arrives finished, then closes", () => {
    const streaming = { ...ctx, partialMessages: true };
    const lines = claudeDialect.beat(
      { kind: "text", text: "Looking at the retry code." },
      0,
      streaming,
    );
    const events = lines.map((line) =>
      line.type === "stream_event"
        ? ((line.event as { type: string }).type as string)
        : String(line.type),
    );

    expect(events[0]).toBe("message_start");
    expect(events[1]).toBe("content_block_start");
    expect(events.slice(-2)).toEqual(["assistant", "content_block_stop"]);
    const deltas = lines.flatMap((line) => {
      const delta = (line.event as { delta?: { text?: string } } | undefined)?.delta;
      return delta?.text ? [delta.text] : [];
    });
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe("Looking at the retry code.");
    expect(lines.map((line) => line.session_id)).toEqual(lines.map(() => "sess-1"));
  });

  test("with partial messages, reasoning streams too and a tool call's input comes whole", () => {
    const streaming = { ...ctx, partialMessages: true };
    const thinking = claudeDialect.beat({ kind: "thinking", text: "Plan it first." }, 0, streaming);
    const call = claudeDialect.beat({ kind: "shell", command: "ls", output: "a" }, 1, streaming);
    const deltaTypes = [...thinking, ...call].flatMap((line) => {
      const delta = (line.event as { delta?: { type: string } } | undefined)?.delta;
      return delta ? [delta.type] : [];
    });

    expect(deltaTypes).toContain("thinking_delta");
    expect(deltaTypes.filter((type) => type === "input_json_delta")).toHaveLength(1);
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
      content: [{ type: "text", text: '{"threadId":"t1"}' }],
      is_error: false,
    });
    expect(contentOf(failed)[0]).toMatchObject({ is_error: true });
  });

  test("a rate-limit ending is the documented limit shape: event, flagged reply, 429 result", () => {
    const before = Math.round(Date.now() / 1000);
    const [limit, reply, result] = claudeDialect.end(
      { kind: "rate-limit", resetsInSeconds: 90 },
      ctx,
    );
    const after = Math.round(Date.now() / 1000);

    const info = (limit?.rate_limit_info ?? {}) as { status: string; resetsAt: number };
    expect(limit).toMatchObject({ type: "rate_limit_event", session_id: "sess-1" });
    expect(info.status).toBe("rejected");
    expect(info.resetsAt).toBeGreaterThanOrEqual(before + 90);
    expect(info.resetsAt).toBeLessThanOrEqual(after + 90);
    expect(reply).toMatchObject({ type: "assistant", error: "rate_limit" });
    expect(JSON.stringify(reply)).toMatch(
      /You've hit your session limit · resets \d{1,2}:\d{2}(am|pm)/,
    );
    expect(result).toMatchObject({
      type: "result",
      is_error: true,
      api_error_status: 429,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  });

  // Shapes recorded from Claude Code 2.1.285 on a Max login by the real-runtime harness.
  test("a turn with usagewarn writes the real allowed_warning event, which is not a limit", () => {
    expect(claudeDialect.start(ctx).map((line) => line.type)).toEqual(["system"]);

    const [, warning] = claudeDialect.start({ ...ctx, usageWarning: true });

    expect(warning).toMatchObject({
      type: "rate_limit_event",
      session_id: "sess-1",
      rate_limit_info: {
        status: "allowed_warning",
        rateLimitType: "seven_day",
        utilization: 0.86,
        isUsingOverage: false,
        surpassedThreshold: 0.75,
        unifiedWindows: { five_hour: { utilization: 0.06 }, seven_day: { utilization: 0.86 } },
      },
    });
    const info = (warning?.rate_limit_info ?? {}) as Record<string, unknown>;
    expect(info).not.toHaveProperty("overageStatus");
    expect(typeof info.resetsAt).toBe("number");
  });

  test("a success result carries what the real one does: a null api_error_status and no denials", () => {
    const [, result] = claudeDialect.end({ kind: "success", text: "done" }, ctx);

    expect(result).toMatchObject({
      type: "result",
      subtype: "success",
      is_error: false,
      api_error_status: null,
      permission_denials: [],
      stop_reason: "end_turn",
      terminal_reason: "completed",
    });
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

  test("a launch that names no model reports its usage under the stable label fake-claude", () => {
    const result = claudeDialect.end({ kind: "success", text: "done" }, ctx).at(-1);
    const [start] = claudeDialect.start(ctx);

    expect(Object.keys((result?.modelUsage as Record<string, unknown>) ?? {})).toEqual([
      "fake-claude",
    ]);
    expect(start).toMatchObject({ model: "fake-claude" });
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
