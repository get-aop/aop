import { describe, expect, test } from "bun:test";
import { VISUALIZE_LIMITS } from "@aop/common";
import { buildRepairPrompt, buildVisualizePrompt, extractCandidate } from "./prompt.ts";

describe("extractCandidate", () => {
  test("takes a bare diagram, or the first fenced block of an answer that fenced one", () => {
    expect(extractCandidate("  flowchart TD\nA-->B \n", "auto")).toEqual({
      kind: "mermaid",
      source: "flowchart TD\nA-->B",
    });
    expect(
      extractCandidate("Sure!\n```mermaid\ntimeline\n  2020 : a\n```\nmore", "timeline"),
    ).toEqual({
      kind: "mermaid",
      source: "timeline\n  2020 : a",
    });
  });

  test("a table is Markdown, and only a real table counts", () => {
    expect(extractCandidate("| a | b |\n| --- | --- |\n| 1 | 2 |", "table")).toEqual({
      kind: "markdown",
      source: "| a | b |\n| --- | --- |\n| 1 | 2 |",
    });
    expect(extractCandidate("a, b\n1, 2", "table")).toBeNull();
    expect(extractCandidate("   ", "auto")).toBeNull();
  });
});

describe("prompts", () => {
  test("the draw prompt names the type and holds the reply, cut at the limit", () => {
    const prompt = buildVisualizePrompt("mindmap", "x".repeat(VISUALIZE_LIMITS.replyMaxChars + 10));
    expect(prompt).toContain("Draw a Mermaid mindmap");
    expect(prompt).toContain("[… the rest of the reply is left out]");
    expect(prompt.length).toBeLessThan(VISUALIZE_LIMITS.replyMaxChars + 600);
  });

  test("the repair prompt carries the error and the diagram, last", () => {
    const prompt = buildRepairPrompt("flowchart", "flowchart TD\nA-->", "Expecting 'AMP'");
    expect(prompt).toContain("Expecting 'AMP'");
    expect(prompt.endsWith("flowchart TD\nA-->")).toBe(true);
  });
});
