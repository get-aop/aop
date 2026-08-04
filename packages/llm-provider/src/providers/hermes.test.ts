import { describe, expect, test } from "bun:test";
import { HermesProvider } from "./hermes";

describe("HermesProvider", () => {
  test("maps workflow openai overrides onto Hermes codex routing", () => {
    const provider = new HermesProvider("developer-1");

    const command = provider.buildCommand({
      prompt: "Implement the task",
      cwd: "/tmp/repo",
      logFilePath: "/tmp/hermes.jsonl",
      model: "gpt-5.4",
      reasoningEffort: "xhigh",
      env: { AOP_TASK_ID: "task-1" },
    });

    expect(command[0]).toBe("bun");
    expect(command).toContain("--profile");
    expect(command).toContain("developer-1");
    expect(command).toContain("--provider");
    expect(command).toContain("openai-codex");
    expect(command).toContain("--model");
    expect(command).toContain("gpt-5.4");
    expect(command).toContain("--log-file");
    expect(command).toContain("/tmp/hermes.jsonl");
  });

  test("maps anthropic models onto the Hermes anthropic provider", () => {
    const provider = new HermesProvider();

    const command = provider.buildCommand({
      prompt: "Review the task",
      logFilePath: "/tmp/hermes.jsonl",
      model: "claude-sonnet-4-6",
    });

    expect(command).toContain("--provider");
    expect(command).toContain("anthropic");
  });
});
