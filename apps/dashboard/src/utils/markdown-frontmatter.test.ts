import { describe, expect, test } from "bun:test";
import { stripMarkdownFrontmatter } from "./markdown-frontmatter.ts";

describe("stripMarkdownFrontmatter", () => {
  test("removes YAML frontmatter from task markdown", () => {
    const markdown = [
      "---",
      "title: Compact cards",
      "status: DRAFT",
      "assignee: null",
      "---",
      "",
      "## Description",
      "Improve the unassigned lane.",
      "",
    ].join("\n");

    expect(stripMarkdownFrontmatter(markdown)).toBe(
      ["## Description", "Improve the unassigned lane.", ""].join("\n"),
    );
  });

  test("returns the original markdown when frontmatter is missing", () => {
    const markdown = "## Description\n\nPlain markdown.";
    expect(stripMarkdownFrontmatter(markdown)).toBe(markdown);
  });
});
