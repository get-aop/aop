import { describe, expect, test } from "bun:test";
import {
  assistantText,
  flagValue,
  initOf,
  parseEvents,
  permissionDenials,
  rateLimitEvents,
  resultOf,
  shapeOf,
  toolCallsOf,
} from "./log-shapes.ts";
import {
  initEvent,
  REAL_RATE_LIMIT_EVENT,
  resultEvent,
  text,
  toolResult,
  toolUse,
} from "./test-utils.ts";

describe("log shapes", () => {
  test("reads the init event: tools, servers, model, permission mode and session", () => {
    const init = initOf([initEvent({ permissionMode: "bypassPermissions" })]);

    expect(init).toEqual({
      tools: ["mcp__aop__thread_spawn"],
      mcpServers: [{ name: "aop", status: "connected" }],
      model: "claude-sonnet-5-5",
      permissionMode: "bypassPermissions",
      sessionId: "sess-1",
    });
    expect(initOf([resultEvent()])).toBeNull();
  });

  test("joins a tool call with its result, for string and block content alike", () => {
    const calls = toolCallsOf([
      toolUse("a", "Bash", { command: "ls" }),
      toolResult("a", "file.txt"),
      toolUse("b", "mcp__aop__thread_spawn"),
      toolResult("b", [{ type: "text", text: '{"id":"t1"}' }]),
      toolUse("c", "Bash", { command: "bun test" }),
      toolResult("c", "This command requires approval", true),
      toolUse("d", "Read"),
    ]);

    expect(calls.map((call) => [call.name, call.result?.isError, call.result?.text])).toEqual([
      ["Bash", false, "file.txt"],
      ["mcp__aop__thread_spawn", false, '{"id":"t1"}'],
      ["Bash", true, "This command requires approval"],
      ["Read", undefined, undefined],
    ]);
  });

  test("finds the result, the reply text, the rate limit events and the denials", () => {
    const denial = { tool_name: "Bash", tool_input: { command: "bun test" } };
    const events = [
      initEvent(),
      text("one"),
      REAL_RATE_LIMIT_EVENT,
      text("two"),
      resultEvent({ permission_denials: [denial] }),
    ];

    expect(assistantText(events)).toBe("one\ntwo");
    expect(rateLimitEvents(events)).toEqual([REAL_RATE_LIMIT_EVENT]);
    expect(permissionDenials(events)).toEqual([denial]);
    expect(resultOf(events)?.subtype).toBe("success");
    expect(resultOf([initEvent()])).toBeNull();
  });

  test("parses a log and skips a torn last line", () => {
    const log = `${JSON.stringify(initEvent())}\n{"type":"assi`;

    expect(parseEvents(log).map((event) => event.type)).toEqual(["system"]);
  });

  test("a flag's value is the argument after it", () => {
    expect(flagValue(["--model", "sonnet", "--effort"], "--model")).toBe("sonnet");
    expect(flagValue(["--model", "sonnet", "--effort"], "--effort")).toBeNull();
    expect(flagValue(["--model"], "--tools")).toBeNull();
  });

  test("the shape of a value keeps names and drops contents", () => {
    expect(
      shapeOf({ a: "secret", b: 1, c: null, d: [{ e: true }], f: { g: { h: { i: { j: 1 } } } } }),
    ).toEqual({
      a: "string",
      b: "number",
      c: "null",
      d: [{ e: "boolean" }],
      f: { g: { h: { i: "{...}" } } },
    });
  });
});
