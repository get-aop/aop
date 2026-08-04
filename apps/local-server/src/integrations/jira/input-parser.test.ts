import { describe, expect, test } from "bun:test";

interface InputParserModule {
  parseJiraIssueInput(input: string): { keys: string[] };
}

const loadInputParserModule = async (): Promise<InputParserModule> =>
  (await import("./input-parser.ts")) as InputParserModule;

describe("integrations/jira/input-parser", () => {
  test("parses a single Jira issue key and normalizes it", async () => {
    const { parseJiraIssueInput } = await loadInputParserModule();

    expect(parseJiraIssueInput("get-50")).toEqual({
      keys: ["GET-50"],
    });
  });

  test("extracts keys from Jira browse and selected issue URLs", async () => {
    const { parseJiraIssueInput } = await loadInputParserModule();

    expect(
      parseJiraIssueInput(
        "https://acme.atlassian.net/browse/get-50, https://acme.atlassian.net/jira/software/c/projects/GET/boards/1?selectedIssue=get-51",
      ),
    ).toEqual({
      keys: ["GET-50", "GET-51"],
    });
  });

  test("parses mixed input and collapses duplicates in first-seen order", async () => {
    const { parseJiraIssueInput } = await loadInputParserModule();

    expect(parseJiraIssueInput("GET-50\nGET-51, https://acme.atlassian.net/browse/get-50")).toEqual(
      {
        keys: ["GET-50", "GET-51"],
      },
    );
  });

  test("rejects input without a Jira issue key", async () => {
    const { parseJiraIssueInput } = await loadInputParserModule();

    expect(() => parseJiraIssueInput("https://acme.atlassian.net/projects/GET")).toThrow(
      "Invalid Jira issue reference",
    );
  });
});
