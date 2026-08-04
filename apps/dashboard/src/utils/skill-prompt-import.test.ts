import { describe, expect, mock, test } from "bun:test";
import {
  buildStepBlockUpdatesFromSkillMarkdown,
  fetchSkillMarkdownFromUrl,
  normalizeSkillMarkdownUrl,
  parseSkillMarkdown,
  SkillImportError,
  skillNameToBlockId,
} from "./skill-prompt-import.ts";

describe("parseSkillMarkdown", () => {
  test("extracts frontmatter metadata and body prompt", () => {
    const parsed = parseSkillMarkdown(`---
name: code-review
description: Review implementation changes for risks and missing tests.
---

# Code Review

Check the diff and report issues.
`);

    expect(parsed).toEqual({
      name: "code-review",
      description: "Review implementation changes for risks and missing tests.",
      prompt: "# Code Review\n\nCheck the diff and report issues.",
    });
  });

  test("returns raw content when frontmatter is missing", () => {
    const parsed = parseSkillMarkdown("Plain skill instructions without frontmatter.");

    expect(parsed).toEqual({
      name: undefined,
      description: undefined,
      prompt: "Plain skill instructions without frontmatter.",
    });
  });
});

describe("skillNameToBlockId", () => {
  test("normalizes skill names into block ids", () => {
    expect(skillNameToBlockId("Code Review")).toBe("code_review");
    expect(skillNameToBlockId("release-checklist")).toBe("release_checklist");
  });
});

describe("buildStepBlockUpdatesFromSkillMarkdown", () => {
  test("fills empty id and description from frontmatter", () => {
    const updates = buildStepBlockUpdatesFromSkillMarkdown(
      `---
name: humanizer
description: Remove AI writing patterns from text.
---

Humanize the draft.`,
      { id: "", description: "" },
    );

    expect(updates).toEqual({
      promptTemplate: "Humanize the draft.",
      id: "humanizer",
      description: "Remove AI writing patterns from text.",
    });
  });
});

describe("normalizeSkillMarkdownUrl", () => {
  test("accepts raw githubusercontent URLs unchanged", () => {
    expect(
      normalizeSkillMarkdownUrl(
        "https://raw.githubusercontent.com/blader/humanizer/refs/heads/main/SKILL.md",
      ),
    ).toBe("https://raw.githubusercontent.com/blader/humanizer/refs/heads/main/SKILL.md");
  });

  test("converts github blob URLs to raw URLs", () => {
    expect(
      normalizeSkillMarkdownUrl("https://github.com/blader/humanizer/blob/main/SKILL.md"),
    ).toBe("https://raw.githubusercontent.com/blader/humanizer/main/SKILL.md");
  });

  test("rejects empty URLs", () => {
    expect(() => normalizeSkillMarkdownUrl("   ")).toThrow(SkillImportError);
  });
});

describe("fetchSkillMarkdownFromUrl", () => {
  test("fetches markdown content from a normalized URL", async () => {
    const fetchImpl = mock(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        "---\nname: humanizer\ndescription: Humanize text.\n---\n\nRemove AI patterns.",
    }));

    const content = await fetchSkillMarkdownFromUrl(
      "https://github.com/blader/humanizer/blob/main/SKILL.md",
      fetchImpl as unknown as typeof fetch,
    );

    expect(content).toContain("Remove AI patterns.");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/blader/humanizer/main/SKILL.md",
      { headers: { Accept: "text/plain, text/markdown, */*" } },
    );
  });

  test("surfaces HTTP failures", async () => {
    const fetchImpl = mock(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    }));

    await expect(
      fetchSkillMarkdownFromUrl(
        "https://raw.githubusercontent.com/example/missing/SKILL.md",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Could not fetch SKILL.md (404 Not Found).");
  });
});
