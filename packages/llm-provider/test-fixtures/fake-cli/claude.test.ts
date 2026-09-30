import { describe, expect, test } from "bun:test";
import { ClaudeCodeProvider } from "../../src/providers/claude-code";
import { claudeDialect } from "./claude";
import type { JsonLine, TurnContext } from "./types";

const ctx: TurnContext = {
  sessionId: "sess-1",
  cwd: "/work",
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
      fastMode: true,
      accessMode: "auto",
    });

    expect(claudeDialect.matches(args)).toBe(true);
    expect(claudeDialect.parse(args)).toEqual({
      prompt: "do the thing",
      resumeId: "sess-1",
      model: "opus",
    });
  });

  test("handles the hermetic defaults of a first turn", () => {
    const [, ...args] = new ClaudeCodeProvider().buildCommand({ prompt: "first turn" });

    expect(claudeDialect.parse(args)).toEqual({
      prompt: "first turn",
      resumeId: undefined,
      model: undefined,
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

  test("a silent ending emits no terminal event", () => {
    expect(claudeDialect.end({ kind: "silent" }, ctx)).toEqual([]);
  });
});
