import { describe, expect, test } from "bun:test";
import { outlineOf } from "./outline.ts";

describe("outlineOf", () => {
  test("headings lead, lists keep their nesting under them, paragraphs give their sentences", () => {
    const reply = [
      "Intro sentence one. Intro **two**.",
      "",
      "## Steps",
      "1. Bump the [version](https://x)",
      "   - on a branch",
      "",
      "```sh",
      "bun run release",
      "```",
      "",
      "| a | b |",
      "### Risks",
      "Notarization can fail.",
    ].join("\n");

    expect(outlineOf(reply)).toBe(
      [
        "# Outline",
        "",
        "- Intro sentence one.",
        "- Intro two.",
        "- **Steps**",
        "  - Bump the version",
        "    - on a branch",
        "  - **Risks**",
        "    - Notarization can fail.",
      ].join("\n"),
    );
  });

  test("long items are cut, and a reply with nothing to outline says so", () => {
    expect(outlineOf(`- ${"word ".repeat(60)}`)).toContain("…");
    expect(outlineOf("```\ncode only\n```")).toBe(
      "# Outline\n\n- (The reply has no text to outline.)",
    );
  });
});
