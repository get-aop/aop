import { describe, expect, test } from "bun:test";
import { parseControlCommand } from "./control-command.ts";

describe("parseControlCommand", () => {
  test("preserves prompt indentation when removing the control marker", () => {
    const prompt = [
      "Inspect this:",
      "    if (ready) {",
      "\t\trun();",
      "    } $CC_BROWSER_USE[claude-opus-4-8;medium]",
    ].join("\n");

    expect(parseControlCommand(prompt)).toMatchObject({
      prompt: ["Inspect this:", "    if (ready) {", "\t\trun();", "    }"].join("\n"),
    });
  });

  test("parses the Claude control commands", () => {
    expect(parseControlCommand("open the page $CC_BROWSER_USE")).toEqual({
      command: { provider: "claude-code", capability: "browser" },
      prompt: "open the page",
    });
    expect(parseControlCommand("$CC_COMPUTER_USE[claude-opus-4-8;high] click it")).toMatchObject({
      command: {
        provider: "claude-code",
        capability: "computer",
        model: "claude-opus-4-8",
        reasoning: "high",
      },
    });
  });

  test("does not recognize a Codex control command", () => {
    expect(parseControlCommand("$CX_BROWSER_USE open the page")).toBeNull();
  });
});
