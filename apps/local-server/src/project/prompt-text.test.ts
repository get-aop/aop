import { describe, expect, test } from "bun:test";
import { clip, cutAtLine, oneLine } from "./prompt-text.ts";

describe("clip", () => {
  test("leaves short text alone and ends a cut one on an ellipsis within the limit", () => {
    expect(clip("short", 10)).toBe("short");
    expect(clip("0123456789", 10)).toBe("0123456789");
    expect(clip("0123456789A", 10)).toBe("012345678…");
  });
});

describe("oneLine", () => {
  test("turns any run of whitespace, line breaks included, into one space", () => {
    expect(oneLine("  a\n\n## b \t c  ", 100)).toBe("a ## b c");
  });

  test("cuts to the limit after collapsing", () => {
    expect(oneLine(`${"word ".repeat(50)}`, 20)).toHaveLength(20);
  });
});

describe("cutAtLine", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`.padEnd(9, ".")).join("\n");

  test("leaves text within the limit whole", () => {
    expect(cutAtLine(lines, lines.length)).toBe(lines);
  });

  test("ends at the last line break when it is within the last fifth, so no line is left half written", () => {
    const cut = cutAtLine(lines, 85);

    expect(cut).toBe(lines.split("\n").slice(0, 8).join("\n"));
    expect(cut.endsWith("line 7...")).toBe(true);
  });

  test("cuts mid-line when the last break would give up more than a fifth of the room", () => {
    const text = `short\n${"x".repeat(500)}`;

    expect(cutAtLine(text, 100)).toBe(text.slice(0, 100));
  });
});
