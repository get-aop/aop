import { describe, expect, test } from "bun:test";
import { parseClaudeCodeUsage } from "./claude-code-usage.ts";
import { assistantEvent, claudeLog, initEvent, resultEvent } from "./test-utils.ts";

const usage = (input: number, output: number, cacheWrite: number, cacheRead: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
});

const modelUsage = (
  input: number,
  output: number,
  cacheWrite: number,
  cacheRead: number,
  costUSD: number,
) => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreationInputTokens: cacheWrite,
  cacheReadInputTokens: cacheRead,
  webSearchRequests: 0,
  costUSD,
});

describe("parseClaudeCodeUsage from the result event", () => {
  test("reads tokens and cost per model from modelUsage, cache buckets included", () => {
    const log = claudeLog(
      initEvent(),
      resultEvent({
        usage: usage(2, 900, 8000, 30_000),
        total_cost_usd: 0.31,
        modelUsage: {
          "claude-opus-5-5[1m]": modelUsage(2, 800, 8000, 30_000, 0.3),
          "claude-haiku-5": modelUsage(500, 100, 0, 0, 0.01),
        },
      }),
    );

    expect(parseClaudeCodeUsage(log)).toEqual([
      {
        model: "claude-opus-5-5[1m]",
        inputTokens: 2,
        outputTokens: 800,
        cacheWriteTokens: 8000,
        cacheReadTokens: 30_000,
        costUsd: 0.3,
      },
      {
        model: "claude-haiku-5",
        inputTokens: 500,
        outputTokens: 100,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costUsd: 0.01,
      },
    ]);
  });

  test("without modelUsage it uses the run-wide usage and cost under the model the run named", () => {
    const log = claudeLog(
      initEvent("claude-sonnet-5"),
      assistantEvent("msg_1", usage(1, 1, 1, 1), "claude-sonnet-5"),
      resultEvent({ usage: usage(40, 50, 60, 70), total_cost_usd: 0.02 }),
    );

    expect(parseClaudeCodeUsage(log)).toEqual([
      {
        model: "claude-sonnet-5",
        inputTokens: 40,
        outputTokens: 50,
        cacheWriteTokens: 60,
        cacheReadTokens: 70,
        costUsd: 0.02,
      },
    ]);
  });

  test("a reported cost of zero stays zero, and a missing one stays null", () => {
    const zero = parseClaudeCodeUsage(
      claudeLog(resultEvent({ usage: usage(1, 1, 0, 0), total_cost_usd: 0 })),
    );
    const missing = parseClaudeCodeUsage(claudeLog(resultEvent({ usage: usage(1, 1, 0, 0) })));

    expect(zero[0]?.costUsd).toBe(0);
    expect(missing[0]?.costUsd).toBeNull();
    expect(missing[0]?.model).toBe("unknown");
  });

  test("a failed run still reports what it consumed", () => {
    const log = claudeLog(
      resultEvent({
        subtype: "error_during_execution",
        is_error: true,
        usage: usage(5, 6, 7, 8),
        modelUsage: { "claude-opus-5-5": modelUsage(5, 6, 7, 8, 0.1) },
      }),
    );

    expect(parseClaudeCodeUsage(log)).toHaveLength(1);
  });

  test("results of a log that holds two invocations add up per model", () => {
    const first = resultEvent({ modelUsage: { m: modelUsage(1, 2, 3, 4, 0.5) } });
    const second = resultEvent({ modelUsage: { m: modelUsage(10, 20, 30, 40, 1) } });

    expect(parseClaudeCodeUsage(claudeLog(first, second))).toEqual([
      {
        model: "m",
        inputTokens: 11,
        outputTokens: 22,
        cacheWriteTokens: 33,
        cacheReadTokens: 44,
        costUsd: 1.5,
      },
    ]);
  });

  test("a process that answered a steer with a second turn counts its last result only", () => {
    // Claude Code 2.1.287: each result's modelUsage and cost add up the process's turns so far.
    const first = resultEvent({ result_index: 0, modelUsage: { m: modelUsage(1, 2, 3, 4, 0.5) } });
    const second = resultEvent({
      result_index: 1,
      modelUsage: { m: modelUsage(3, 5, 7, 9, 1.25) },
    });
    const retried = resultEvent({
      result_index: 0,
      modelUsage: { m: modelUsage(1, 1, 1, 1, 0.25) },
    });

    expect(parseClaudeCodeUsage(claudeLog(first, second))).toEqual([
      {
        model: "m",
        inputTokens: 3,
        outputTokens: 5,
        cacheWriteTokens: 7,
        cacheReadTokens: 9,
        costUsd: 1.25,
      },
    ]);
    // A second process in the same log (a retry on a fresh session) adds up as before.
    expect(parseClaudeCodeUsage(claudeLog(first, second, retried))[0]?.costUsd).toBe(1.5);
  });

  test("clamps negative and non-numeric counts to zero instead of storing them", () => {
    const log = claudeLog(
      resultEvent({
        modelUsage: {
          m: { ...modelUsage(-5, 7, 0, 0, -1), cacheReadInputTokens: "lots" },
        },
      }),
    );

    expect(parseClaudeCodeUsage(log)).toEqual([
      {
        model: "m",
        inputTokens: 0,
        outputTokens: 7,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costUsd: null,
      },
    ]);
  });
});

describe("parseClaudeCodeUsage without a result event", () => {
  test("sums assistant messages, counting a message once however many blocks repeat it", () => {
    const log = claudeLog(
      initEvent(),
      assistantEvent("msg_1", usage(3, 100, 1000, 5000)),
      assistantEvent("msg_1", usage(3, 100, 1000, 5000)),
      assistantEvent("msg_2", usage(4, 200, 0, 6000)),
    );

    expect(parseClaudeCodeUsage(log)).toEqual([
      {
        model: "claude-opus-5-5",
        inputTokens: 7,
        outputTokens: 300,
        cacheWriteTokens: 1000,
        cacheReadTokens: 11_000,
        costUsd: null,
      },
    ]);
  });

  test("keeps the last usage of a message that is streamed in growing snapshots", () => {
    const log = claudeLog(
      assistantEvent("msg_1", usage(3, 1, 0, 0)),
      assistantEvent("msg_1", usage(3, 250, 0, 0)),
    );

    expect(parseClaudeCodeUsage(log)[0]?.outputTokens).toBe(250);
  });

  test("groups by the model of each message and skips Claude's synthetic error messages", () => {
    const log = claudeLog(
      assistantEvent("msg_1", usage(1, 1, 0, 0), "claude-opus-5-5"),
      assistantEvent("msg_2", usage(2, 2, 0, 0), "claude-haiku-5"),
      assistantEvent("msg_3", usage(0, 0, 0, 0), "<synthetic>"),
    );

    expect(parseClaudeCodeUsage(log).map((entry) => entry.model)).toEqual([
      "claude-opus-5-5",
      "claude-haiku-5",
    ]);
  });

  test("a log cut off mid-line still yields the messages written before the cut", () => {
    const whole = claudeLog(initEvent(), assistantEvent("msg_1", usage(9, 9, 9, 9)));
    const torn = `${whole}{"type":"assistant","message":{"id":"msg_2","usa`;

    expect(parseClaudeCodeUsage(torn)).toHaveLength(1);
  });
});

describe("parseClaudeCodeUsage with nothing to count", () => {
  test.each([
    ["an empty log", ""],
    ["a log with only an init event", claudeLog(initEvent())],
    ["a result without usage", claudeLog(resultEvent({ result: "done" }))],
    ["a result whose usage is all zero", claudeLog(resultEvent({ usage: usage(0, 0, 0, 0) }))],
    ["text that is not JSON", "Segmentation fault\n"],
  ])("returns nothing for %s", (_label, log) => {
    expect(parseClaudeCodeUsage(log)).toEqual([]);
  });
});
