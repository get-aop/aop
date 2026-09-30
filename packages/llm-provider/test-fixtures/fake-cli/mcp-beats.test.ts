import { describe, expect, test } from "bun:test";
import { carryOut } from "./mcp-beats";
import type { McpConnection, McpResult } from "./types";

const connection = (result: McpResult) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const aop: McpConnection = {
    callTool: async (name, args) => {
      calls.push({ name, args });
      return result;
    },
  };
  return { aop, calls };
};

describe("carryOut", () => {
  test("sends an MCP call to the server and keeps the result the model saw", async () => {
    const { aop, calls } = connection({ text: "spawned", isError: false });
    const call = { name: "thread_spawn", arguments: { title: "Fix login" } };

    const beat = await carryOut({ kind: "call", call }, aop);

    expect(calls).toEqual([{ name: "thread_spawn", args: { title: "Fix login" } }]);
    expect(beat).toEqual({ kind: "mcp", call, result: { text: "spawned", isError: false } });
  });

  test("without an aop server a call comes back as an error result, not a crash", async () => {
    const call = { name: "thread_list", arguments: {} };

    const beat = await carryOut({ kind: "call", call }, undefined);

    expect(beat).toEqual({
      kind: "mcp",
      call,
      result: { text: "MCP server aop is not connected", isError: true },
    });
  });

  test("a question to the default tool becomes a real aop_ask_user call", async () => {
    const { aop, calls } = connection({ text: "Question sent.", isError: false });
    const ask = { question: "Which one?", options: ["a", "b"], tool: "aop_ask_user" };

    const beat = await carryOut({ kind: "ask", ask }, aop);

    expect(calls).toEqual([
      { name: "aop_ask_user", args: { question: "Which one?", options: ["a", "b"] } },
    ]);
    expect(beat).toMatchObject({ kind: "mcp", result: { text: "Question sent." } });
  });

  test("a question stays a scripted event without a server or for another tool", async () => {
    const { aop, calls } = connection({ text: "unused", isError: false });
    const scripted = { question: "q", options: [], tool: "aop_ask_user" };
    const native = { question: "q", options: [], tool: "AskUserQuestion" };

    expect(await carryOut({ kind: "ask", ask: scripted }, undefined)).toEqual({
      kind: "ask",
      ask: scripted,
    });
    expect(await carryOut({ kind: "ask", ask: native }, aop)).toEqual({ kind: "ask", ask: native });
    expect(calls).toEqual([]);
  });

  test("text and shell beats pass through untouched", async () => {
    const { aop, calls } = connection({ text: "unused", isError: false });
    const text = { kind: "text", text: "hi" } as const;

    expect(await carryOut(text, aop)).toBe(text);
    expect(calls).toEqual([]);
  });
});
