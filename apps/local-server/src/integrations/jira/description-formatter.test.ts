import { describe, expect, test } from "bun:test";

interface DescriptionFormatterModule {
  formatJiraDescription(description: unknown): string | null;
}

const loadDescriptionFormatterModule = async (): Promise<DescriptionFormatterModule> =>
  (await import("./description-formatter.ts")) as DescriptionFormatterModule;

describe("integrations/jira/description-formatter", () => {
  test("formats common Atlassian Document Format nodes as readable text", async () => {
    const { formatJiraDescription } = await loadDescriptionFormatterModule();

    expect(
      formatJiraDescription({
        type: "doc",
        version: 1,
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Build Jira import" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Review " },
              {
                type: "text",
                text: "the spec",
                marks: [{ type: "link", attrs: { href: "https://example.com/spec" } }],
              },
              { type: "text", text: "." },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Parse keys" }] }],
              },
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Format descriptions" }] },
                ],
              },
            ],
          },
          { type: "codeBlock", content: [{ type: "text", text: "bun test" }] },
        ],
      }),
    ).toBe(
      "## Build Jira import\n\nReview the spec (https://example.com/spec).\n\n- Parse keys\n- Format descriptions\n\n```\nbun test\n```",
    );
  });

  test("returns trimmed plain text or null for empty descriptions", async () => {
    const { formatJiraDescription } = await loadDescriptionFormatterModule();

    expect(formatJiraDescription("  Plain Jira description  ")).toBe("Plain Jira description");
    expect(formatJiraDescription({ type: "doc", content: [] })).toBeNull();
    expect(formatJiraDescription(null)).toBeNull();
  });
});
