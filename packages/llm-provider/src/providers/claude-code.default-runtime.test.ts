import { describe, expect, test } from "bun:test";
import type { RunOptions } from "../types";
import { ClaudeCodeProvider } from "./claude-code";

describe("buildCommand on Claude Code's own default model and effort", () => {
  // Everything a project session sets besides its model: the AOP tools, an approval policy, a brief.
  const projectRun: RunOptions = {
    prompt: "the prompt",
    isolation: "hermetic",
    accessMode: "approval-required",
    mcpServerUrl: "http://127.0.0.1:25350/api/mcp?sessionId=s&accessToken=t",
    disallowedTools: ["AskUserQuestion"],
    allowedTools: ["mcp__aop__thread_spawn"],
    builtInTools: [],
  };
  const VARIADIC = ["--mcp-config", "--disallowedTools", "--allowedTools", "--add-dir", "--tools"];
  // The last flag before the prompt: when it is variadic, it takes the prompt as one of its values.
  const flagBeforePrompt = (cmd: string[]): string | undefined =>
    cmd
      .slice(0, cmd.lastIndexOf("the prompt"))
      .reverse()
      .find((part) => part.startsWith("--"));

  test("passes neither --model nor --effort when the run names none, fresh or resumed", () => {
    const provider = new ClaudeCodeProvider();

    for (const resumeSessionId of [undefined, "native-1"]) {
      const cmd = provider.buildCommand({ ...projectRun, resumeSessionId });

      expect(cmd).not.toContain("--model");
      expect(cmd).not.toContain("--effort");
      expect(cmd.includes("--resume")).toBe(resumeSessionId !== undefined);
    }
  });

  test("passes only the one that is named", () => {
    const provider = new ClaudeCodeProvider();

    const modelOnly = provider.buildCommand({ ...projectRun, model: "claude-opus-4-8" });
    const effortOnly = provider.buildCommand({ ...projectRun, reasoningEffort: "high" });

    expect(modelOnly).toContain("--model");
    expect(modelOnly).not.toContain("--effort");
    expect(effortOnly).toContain("--effort");
    expect(effortOnly).not.toContain("--model");
  });

  test("passes both when both are named, the way it always has", () => {
    const provider = new ClaudeCodeProvider();

    const cmd = provider.buildCommand({
      ...projectRun,
      model: "claude-opus-4-8",
      reasoningEffort: "extra-high",
      resumeSessionId: "native-1",
    });

    expect(cmd.slice(cmd.indexOf("--model"), cmd.indexOf("--model") + 4)).toEqual([
      "--model",
      "claude-opus-4-8",
      "--effort",
      "xhigh",
    ]);
    expect(cmd.slice(cmd.indexOf("--resume"), cmd.indexOf("--resume") + 2)).toEqual([
      "--resume",
      "native-1",
    ]);
  });

  test("an empty model or effort is no choice either", () => {
    const cmd = new ClaudeCodeProvider().buildCommand({
      ...projectRun,
      model: "",
      reasoningEffort: "",
    });

    expect(cmd).not.toContain("--model");
    expect(cmd).not.toContain("--effort");
  });

  test("the prompt never follows a variadic flag, with no model, no effort and no brief", () => {
    const provider = new ClaudeCodeProvider();

    for (const options of [projectRun, { ...projectRun, appendSystemPrompt: "brief" }]) {
      const cmd = provider.buildCommand(options);

      expect(VARIADIC).not.toContain(flagBeforePrompt(cmd) ?? "");
      expect(cmd.filter((part) => part === "the prompt")).toHaveLength(1);
    }
  });
});
