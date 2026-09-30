import { describe, expect, test } from "bun:test";
import { ClaudeCodeProvider } from "./claude-code";

const build = (options: Parameters<ClaudeCodeProvider["buildCommand"]>[0]): string[] =>
  new ClaudeCodeProvider().buildCommand(options);

const valueAfter = (cmd: string[], flag: string): string | undefined => {
  const index = cmd.indexOf(flag);
  return index < 0 ? undefined : cmd[index + 1];
};

describe("appendSystemPrompt", () => {
  test("is one --append-system-prompt value, with the recorded first-launch prompt turned off", () => {
    const cmd = build({ prompt: "work", appendSystemPrompt: "# Brief\nKeep pull requests small." });

    expect(valueAfter(cmd, "--append-system-prompt")).toBe("# Brief\nKeep pull requests small.");
    expect(valueAfter(cmd, "--system-prompt-snapshot")).toBe("off");
  });

  test("is sent on a resumed launch too, or Claude Code would keep the first launch's text", () => {
    const first = build({ prompt: "one", appendSystemPrompt: "rules v1" });
    const resumed = build({
      prompt: "two",
      appendSystemPrompt: "rules v2",
      resumeSessionId: "s-1",
    });

    expect(first).toContain("--system-prompt-snapshot");
    expect(resumed).toContain("--resume");
    expect(valueAfter(resumed, "--append-system-prompt")).toBe("rules v2");
    expect(valueAfter(resumed, "--system-prompt-snapshot")).toBe("off");
  });

  test("adds nothing when there is no text, so a plain chat's command line is unchanged", () => {
    for (const appendSystemPrompt of [undefined, "", "  \n "]) {
      const cmd = build({ prompt: "hello", appendSystemPrompt });

      expect(cmd).not.toContain("--append-system-prompt");
      expect(cmd).not.toContain("--system-prompt-snapshot");
    }
  });

  test("goes right before the prompt, and no variadic flag comes before either, with no model or effort", () => {
    const cmd = build({
      prompt: "the prompt",
      isolation: "hermetic",
      accessMode: "approval-required",
      mcpServerUrl: "http://127.0.0.1:25350/api/mcp?sessionId=s&accessToken=t",
      disallowedTools: ["AskUserQuestion"],
      appendSystemPrompt: "brief",
    });

    const before = cmd.slice(0, cmd.indexOf("the prompt"));
    expect(before.at(-2)).toBe("--system-prompt-snapshot");
    expect(before.at(-1)).toBe("off");
    // A variadic flag would take the prompt as one of its values, so they follow it.
    expect(cmd.indexOf("--disallowedTools")).toBeGreaterThan(cmd.indexOf("the prompt"));
    expect(cmd.indexOf("--mcp-config")).toBeGreaterThan(cmd.indexOf("the prompt"));
  });

  test("passes a text that begins with dashes or quotes untouched, as one argument", () => {
    const text = '--- "quoted" $(not run) `nor this`';
    const cmd = build({ prompt: "p", appendSystemPrompt: text });

    expect(valueAfter(cmd, "--append-system-prompt")).toBe(text);
  });
});
