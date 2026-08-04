import { describe, expect, test } from "bun:test";
import { extractUsageFromRawJsonl } from "./usage";

describe("extractUsageFromRawJsonl", () => {
  test("returns undefined when no usage data is present", () => {
    const content = JSON.stringify({
      type: "assistant",
      message: "No usage here",
    });

    expect(extractUsageFromRawJsonl(content)).toBeUndefined();
  });

  test("extracts usage from a Claude Code result event", () => {
    const content = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Working" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Done",
        usage: {
          input_tokens: 1234,
          output_tokens: 567,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 200,
        },
        total_cost_usd: 0.0123,
      }),
    ].join("\n");

    const usage = extractUsageFromRawJsonl(content);
    expect(usage).toEqual({
      inputTokens: 1234,
      outputTokens: 567,
      totalTokens: 1801,
      costUsd: 0.0123,
      provider: "claude-code",
      model: undefined,
    });
  });

  test("extracts usage from a Codex CLI turn.completed event", () => {
    const content = JSON.stringify({
      type: "turn.completed",
      "turn-id": "turn_123",
      "last-assistant-message": "done",
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        total_tokens: 1500,
      },
    });

    const usage = extractUsageFromRawJsonl(content);
    expect(usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      costUsd: undefined,
      provider: "codex",
      model: undefined,
    });
  });

  test("extracts usage from an OpenCode finish event", () => {
    const content = JSON.stringify({
      type: "finish",
      reason: "stop",
      usage: {
        input_tokens: 800,
        output_tokens: 400,
      },
    });

    const usage = extractUsageFromRawJsonl(content);
    expect(usage).toEqual({
      inputTokens: 800,
      outputTokens: 400,
      totalTokens: 1200,
      costUsd: undefined,
      provider: "opencode",
      model: undefined,
    });
  });

  test("extracts usage from a Pi agent_end event with model info", () => {
    const content = JSON.stringify({
      type: "agent_end",
      model: "openai-codex/gpt-5.5",
      usage: {
        prompt_tokens: 2000,
        completion_tokens: 800,
        total_tokens: 2800,
        cost_usd: 0.045,
      },
      messages: [],
    });

    const usage = extractUsageFromRawJsonl(content);
    expect(usage).toEqual({
      inputTokens: 2000,
      outputTokens: 800,
      totalTokens: 2800,
      costUsd: 0.045,
      provider: "pi",
      model: "openai-codex/gpt-5.5",
    });
  });

  test("accumulates usage across multiple events", () => {
    const content = [
      JSON.stringify({
        type: "message_end",
        usage: { input_tokens: 500, output_tokens: 200 },
      }),
      JSON.stringify({
        type: "agent_end",
        usage: { input_tokens: 300, output_tokens: 100 },
      }),
    ].join("\n");

    const usage = extractUsageFromRawJsonl(content);
    expect(usage?.inputTokens).toBe(800);
    expect(usage?.outputTokens).toBe(300);
  });

  test("handles alternative token field names (prompt_tokens, completion_tokens)", () => {
    const content = JSON.stringify({
      type: "result",
      usage: {
        prompt_tokens: 600,
        completion_tokens: 300,
      },
    });

    const usage = extractUsageFromRawJsonl(content);
    expect(usage?.inputTokens).toBe(600);
    expect(usage?.outputTokens).toBe(300);
  });

  test("ignores invalid or non-numeric token values", () => {
    const content = JSON.stringify({
      type: "result",
      usage: {
        input_tokens: "not-a-number",
        output_tokens: 100,
      },
    });

    const usage = extractUsageFromRawJsonl(content);
    expect(usage?.inputTokens).toBeUndefined();
    expect(usage?.outputTokens).toBe(100);
  });

  test("returns undefined for empty content", () => {
    expect(extractUsageFromRawJsonl("")).toBeUndefined();
  });
});
