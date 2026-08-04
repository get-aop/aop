import { describe, expect, test } from "bun:test";
import {
  compactFrontmatterValues,
  serializeFrontmatter,
  stripFrontmatterContent,
} from "./frontmatter.ts";

describe("task-docs/frontmatter", () => {
  test("omits null and empty optional fields when serializing frontmatter", () => {
    const serialized = serializeFrontmatter({
      frontmatter: {
        title: "Compact cards",
        status: "DRAFT",
        created: "2026-05-25T22:53:18.099Z",
        changePath: "docs/tasks/compact-unassigned-lane-task-cards",
        priority: "medium",
        tags: [],
        assignee: null,
        dependencies: [],
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
      content: "\n## Description\nImprove the unassigned lane.\n",
    });

    expect(serialized).not.toContain("null");
    expect(serialized).toContain("title: Compact cards");
    expect(serialized).toContain("## Description");
  });

  test("strips frontmatter and returns the markdown body", () => {
    const markdown = [
      "---",
      "title: Example",
      "assignee: null",
      "---",
      "",
      "## Description",
      "Readable task content.",
      "",
    ].join("\n");

    expect(stripFrontmatterContent(markdown)).toBe(
      ["## Description", "Readable task content.", ""].join("\n"),
    );
  });

  test("compactFrontmatterValues keeps meaningful values", () => {
    const compacted = compactFrontmatterValues({
      title: "Example",
      assignee: "celo",
      tags: ["ui"],
      startedAt: null,
    });

    expect(compacted).toMatchObject({
      title: "Example",
      assignee: "celo",
      tags: ["ui"],
    });
    expect(compacted).not.toHaveProperty("startedAt");
  });
});
