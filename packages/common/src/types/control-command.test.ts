import { describe, expect, test } from "bun:test";
import { parseControlCommand } from "./control-command.ts";

describe("parseControlCommand", () => {
  test("preserves prompt indentation when removing the control marker", () => {
    const prompt = [
      "Inspect this:",
      "    if (ready) {",
      "\t\trun();",
      "    } $CX_BROWSER_USE[gpt-5.5;medium]",
    ].join("\n");

    expect(parseControlCommand(prompt)).toMatchObject({
      prompt: ["Inspect this:", "    if (ready) {", "\t\trun();", "    }"].join("\n"),
    });
  });
});
