import { describe, expect, test } from "bun:test";
import { deriveTitleFromSourceText } from "./create-task.ts";

describe("deriveTitleFromSourceText", () => {
  test("strips filler and keeps the first clause as a short action title", () => {
    expect(
      deriveTitleFromSourceText(
        "we need to add the ability to paste clipboard images during task creation, and add those artifacts into issues.md",
      ),
    ).toBe("Paste clipboard images during task creation");
  });

  test("keeps a concise request mostly intact and preserves acronym casing", () => {
    expect(deriveTitleFromSourceText("Add OAuth support")).toBe("Add OAuth support");
  });

  test("drops a leading filler phrase before the verb", () => {
    expect(deriveTitleFromSourceText("we should fix the login redirect bug")).toBe(
      "Fix the login redirect bug",
    );
  });

  test("caps very long single clauses and trims trailing filler", () => {
    expect(
      deriveTitleFromSourceText("implement dark mode toggle for the settings page header"),
    ).toBe("Implement dark mode toggle");
  });

  test("cuts at punctuation", () => {
    expect(deriveTitleFromSourceText("Refactor the executor, then add retries")).toBe(
      "Refactor the executor",
    );
  });

  test("uses the first non-empty line", () => {
    expect(deriveTitleFromSourceText("\n\nFix flaky tests\nand more details")).toBe(
      "Fix flaky tests",
    );
  });

  test("falls back to New Task for empty input", () => {
    expect(deriveTitleFromSourceText("   \n  ")).toBe("New Task");
  });

  test("trims trailing stopwords", () => {
    expect(deriveTitleFromSourceText("update the docs for the")).toBe("Update the docs");
  });
});
