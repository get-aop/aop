import { describe, expect, test } from "bun:test";
import { applyTypeaheadInsert, matchTypeahead } from "./typeahead";

const repos = [
  { id: "r1", name: "aop-mono", path: "/tmp/aop-mono" },
  { id: "r2", name: null, path: "/tmp/scratch" },
];

describe("session typeahead", () => {
  test("matches ~repos and applies insert with trailing space", () => {
    const match = matchTypeahead({ draft: "open ~mon", caret: 9, repos });
    expect(match?.kind).toBe("repo");
    expect(match?.tokenStart).toBe(5);
    expect(match?.items.map((item) => item.id)).toEqual(["r1"]);
    expect(match?.items[0]?.insertText).toBe("~aop-mono ");

    const applied = applyTypeaheadInsert(
      "open ~mon",
      match?.tokenStart ?? 0,
      9,
      match?.items[0]?.insertText ?? "",
    );
    expect(applied.draft).toBe("open ~aop-mono ");
    expect(applied.caret).toBe(applied.draft.length);
  });

  test("lists every repository for a bare ~ and labels unnamed repos by path", () => {
    const match = matchTypeahead({ draft: "~", caret: 1, repos });
    expect(match?.items.map((item) => item.label)).toEqual(["aop-mono", "/tmp/scratch"]);
    expect(match?.items[1]?.insertText).toBe("~r2 ");
  });

  test("matches a repository by id as well as by name", () => {
    const byId = matchTypeahead({
      draft: "~9f3",
      caret: 4,
      repos: [{ id: "repo-9f3", name: "tools", path: "/tmp/tools" }],
    });
    expect(byId?.items.map((item) => item.label)).toEqual(["tools"]);
  });

  test("caps the popover at eight repositories", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `repo-${index}`,
      name: `repo-${index}`,
      path: `/tmp/repo-${index}`,
    }));
    expect(matchTypeahead({ draft: "~repo", caret: 5, repos: many })?.items).toHaveLength(8);
  });

  test("hides the popover when the ~repo token is already complete", () => {
    expect(matchTypeahead({ draft: "~aop-mono", caret: 9, repos })).toBeNull();
    // An unnamed repo completes by its id, the text the insert writes.
    expect(matchTypeahead({ draft: "~r2", caret: 3, repos })).toBeNull();
  });

  test("only completes the token at the caret", () => {
    const match = matchTypeahead({ draft: "~aop then more", caret: 4, repos });
    expect(match?.items.map((item) => item.id)).toEqual(["r1"]);
    expect(matchTypeahead({ draft: "~aop then more", caret: 14, repos })).toBeNull();
  });

  test("ignores a mid-word ~ and the retired % # $ @ sigils", () => {
    expect(matchTypeahead({ draft: "use~aop", caret: 7, repos })).toBeNull();
    for (const draft of ["%ada", "#workflow", "$CC_BROWSER_USE", "@codex"]) {
      expect(matchTypeahead({ draft, caret: draft.length, repos })).toBeNull();
    }
  });

  test("leaves slash commands to the dedicated command menu", () => {
    expect(matchTypeahead({ draft: "/", caret: 1, repos })).toBeNull();
  });
});
