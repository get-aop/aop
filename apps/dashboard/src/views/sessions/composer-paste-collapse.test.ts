import { describe, expect, test } from "bun:test";
import {
  type ComposerPasteEntry,
  expandPasteTokens,
  formatPasteToken,
  nextPasteIndex,
  PASTE_COLLAPSE_MIN_CHARS,
  PASTE_COLLAPSE_MIN_LINES,
  shouldCollapsePaste,
} from "./composer-paste-collapse";

const lines = (count: number, prefix = "line"): string =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join("\n");

describe("shouldCollapsePaste", () => {
  test("keeps short single-line text inline", () => {
    expect(shouldCollapsePaste("please review this")).toBe(false);
  });

  test("collapses when line count meets the threshold", () => {
    expect(shouldCollapsePaste(lines(PASTE_COLLAPSE_MIN_LINES))).toBe(true);
    expect(shouldCollapsePaste(lines(PASTE_COLLAPSE_MIN_LINES - 1))).toBe(false);
  });

  test("collapses when character count meets the threshold", () => {
    expect(shouldCollapsePaste("x".repeat(PASTE_COLLAPSE_MIN_CHARS))).toBe(true);
    expect(shouldCollapsePaste("x".repeat(PASTE_COLLAPSE_MIN_CHARS - 1))).toBe(false);
  });

  test("ignores empty clipboard text", () => {
    expect(shouldCollapsePaste("")).toBe(false);
    expect(shouldCollapsePaste("   \n  ")).toBe(false);
  });
});

describe("formatPasteToken", () => {
  test("matches Claude-style paste tokens", () => {
    expect(formatPasteToken(1, 199)).toBe("[paste #1 +199 lines]");
    expect(formatPasteToken(2, 1)).toBe("[paste #2 +1 line]");
  });
});

describe("nextPasteIndex", () => {
  test("starts at 1 and increments past the highest existing index", () => {
    expect(nextPasteIndex([])).toBe(1);
    expect(nextPasteIndex([{ index: 1 }, { index: 3 }])).toBe(4);
  });
});

describe("expandPasteTokens", () => {
  const pastes: ComposerPasteEntry[] = [
    { id: "p1", index: 1, lineCount: 3, content: "one\ntwo\nthree" },
    { id: "p2", index: 2, lineCount: 2, content: "alpha\nbeta" },
  ];

  test("replaces tokens with full paste bodies", () => {
    const input = `review this\n[paste #1 +3 lines]\nthanks`;
    expect(expandPasteTokens(input, pastes)).toBe("review this\none\ntwo\nthree\nthanks");
  });

  test("expands multiple tokens", () => {
    const input = `[paste #1 +3 lines]\n---\n[paste #2 +2 lines]`;
    expect(expandPasteTokens(input, pastes)).toBe("one\ntwo\nthree\n---\nalpha\nbeta");
  });

  test("leaves unknown tokens unchanged", () => {
    const input = "[paste #9 +4 lines]";
    expect(expandPasteTokens(input, pastes)).toBe(input);
  });

  test("is a no-op without pastes or tokens", () => {
    expect(expandPasteTokens("hello", [])).toBe("hello");
    expect(expandPasteTokens("hello", pastes)).toBe("hello");
  });
});
