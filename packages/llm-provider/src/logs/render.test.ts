import { describe, expect, test } from "bun:test";
import { renderCompactLogLines } from "./render";
import type { ParsedRawLogEntry } from "./types";

describe("renderCompactLogLines", () => {
  test("renders assistant text and filters noise", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: {
          type: "text",
          part: { text: "  Working  \nStep 1 / 2\nTokens: 3\nUsage: small\nDone  " },
        },
        provider: "opencode",
      },
    ];

    const lines = renderCompactLogLines(entries, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    // Should render assistant text and filter out noise patterns (Step, Tokens, Usage)
    expect(lines).toEqual([
      {
        stream: "stdout",
        content: "Working",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        stream: "stdout",
        content: "Done",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("renders tool started events", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: {
          type: "tool_use",
          part: {
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "npm test" },
            },
          },
        },
        provider: "opencode",
      },
      {
        index: 1,
        raw: "{}",
        event: {
          type: "tool_use",
          part: {
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "npm test", description: "Run all tests" },
            },
          },
        },
        provider: "opencode",
      },
    ];

    const lines = renderCompactLogLines(entries, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines).toEqual([
      {
        stream: "stdout",
        content: "[Bash] npm test",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        stream: "stdout",
        content: "[Bash] npm test - Run all tests",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("renders tool completed events", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: {
          type: "tool_execution_end",
          toolName: "Bash",
        },
        provider: "pi",
      },
    ];

    const lines = renderCompactLogLines(entries, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines).toEqual([
      {
        stream: "stdout",
        content: "[Bash] completed",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("renders result success with multiline text", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: {
          type: "result",
          subtype: "success",
          result: "Summary\nCost: 0.01\nFinal",
        },
        provider: "claude-code",
      },
    ];

    const lines = renderCompactLogLines(entries, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines).toEqual([
      {
        stream: "stdout",
        content: "Summary",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        stream: "stdout",
        content: "Final",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("renders Pi final assistant text instead of replaying streaming fragments", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: {
          provider: "pi",
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Read" }],
          },
        },
        provider: "pi",
      },
      {
        index: 1,
        raw: "{}",
        event: {
          provider: "pi",
          type: "agent_end",
          messages: [
            { role: "user", content: [{ type: "text", text: "do it" }] },
            {
              role: "assistant",
              content: [{ type: "text", text: "Reading startup skill\nDone" }],
            },
          ],
        },
        provider: "pi",
      },
    ];

    const lines = renderCompactLogLines(entries, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines.map((line) => line.content)).toEqual(["Reading startup skill", "Done"]);
  });

  test("joins consecutive Grok streaming text chunks", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: { type: "thought", data: "private reasoning" },
        provider: "grok-build",
      },
      {
        index: 1,
        raw: "{}",
        event: { type: "text", data: "Running" },
        provider: "grok-build",
      },
      {
        index: 2,
        raw: "{}",
        event: { type: "text", data: " checks" },
        provider: "grok-build",
      },
    ];

    const lines = renderCompactLogLines(entries, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines.map((line) => line.content)).toEqual(["Running checks"]);
  });

  test("renders errors to stderr", () => {
    const entries: ParsedRawLogEntry[] = [
      {
        index: 0,
        raw: "{}",
        event: {
          type: "error",
          error: "fatal error",
        },
        provider: "opencode",
      },
    ];

    const lines = renderCompactLogLines(entries, {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines).toEqual([
      {
        stream: "stderr",
        content: "fatal error",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });
});
