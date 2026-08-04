import { describe, expect, test } from "bun:test";
import { applyTypeaheadInsert, findRuntimeDelegationCandidate, matchTypeahead } from "./typeahead";

describe("session typeahead", () => {
  test("does not infer delegation from ordinary runtime words", () => {
    expect(findRuntimeDelegationCandidate("ask PI to review this")).toBeNull();
    expect(findRuntimeDelegationCandidate("compare this with OpenCode")).toBeNull();
    expect(findRuntimeDelegationCandidate("Codex and Claude are mentioned in prose")).toBeNull();
  });

  test("matches %workers and applies insert with trailing space", () => {
    const match = matchTypeahead({
      draft: "hello %ad",
      caret: 9,
      workers: [
        { id: "w1", name: "Ada" },
        { id: "w2", name: "Bob" },
      ],
      workflows: ["aop-default-gpt"],
      repos: [],
    });
    expect(match?.kind).toBe("worker");
    expect(match?.items.map((item) => item.label)).toEqual(["Ada"]);
    expect(match?.items[0]?.insertText).toBe("%Ada ");
    const applied = applyTypeaheadInsert(
      "hello %ad",
      match?.tokenStart ?? 0,
      9,
      match?.items[0]?.insertText ?? "",
    );
    expect(applied.draft).toBe("hello %Ada ");
  });

  test("hides popover when %worker token is already complete", () => {
    const match = matchTypeahead({
      draft: "hello %Ada",
      caret: 10,
      workers: [{ id: "w1", name: "Ada" }],
      workflows: [],
      repos: [],
    });
    expect(match).toBeNull();
  });

  test("matches #workflows and ~repos with trailing space inserts", () => {
    const workflows = matchTypeahead({
      draft: "#aop",
      caret: 4,
      workers: [],
      workflows: ["aop-default-gpt", "simple"],
      repos: [],
    });
    expect(workflows?.items[0]?.label).toBe("aop-default-gpt");
    expect(workflows?.items[0]?.insertText).toBe("");

    const repos = matchTypeahead({
      draft: "~mon",
      caret: 4,
      workers: [],
      workflows: [],
      repos: [{ id: "r1", name: "aop-mono", path: "/tmp/aop-mono" }],
    });
    expect(repos?.items[0]?.id).toBe("r1");
    expect(repos?.items[0]?.insertText).toBe("~aop-mono ");
  });

  test("uses $ to offer the four explicit control commands by description", () => {
    const all = matchTypeahead({
      draft: "$",
      caret: 1,
      workers: [],
      workflows: [],
      repos: [],
    });
    expect(all?.kind).toBe("control");
    expect(all?.items.map((item) => item.label)).toEqual([
      "Claude Browser",
      "Codex Browser",
      "Claude Computer",
      "Codex Computer",
    ]);
    expect(all?.items.map((item) => item.insertText)).toEqual([
      "$CC_BROWSER_USE ",
      "$CX_BROWSER_USE ",
      "$CC_COMPUTER_USE ",
      "$CX_COMPUTER_USE ",
    ]);

    const byTechnical = matchTypeahead({
      draft: "please $cx_com",
      caret: 14,
      workers: [],
      workflows: [],
      repos: [],
    });
    expect(byTechnical?.items.map((item) => item.label)).toEqual(["Codex Computer"]);
    expect(byTechnical?.items[0]?.insertText).toBe("$CX_COMPUTER_USE ");

    const byDescription = matchTypeahead({
      draft: "$claude",
      caret: 7,
      workers: [],
      workflows: [],
      repos: [],
    });
    expect(byDescription?.items.map((item) => item.label)).toEqual([
      "Claude Browser",
      "Claude Computer",
    ]);
    expect(byDescription?.items[0]?.insertText).toBe("$CC_BROWSER_USE ");

    const byCapability = matchTypeahead({
      draft: "$browser",
      caret: 8,
      workers: [],
      workflows: [],
      repos: [],
    });
    expect(byCapability?.items.map((item) => item.label)).toEqual([
      "Claude Browser",
      "Codex Browser",
    ]);
  });

  test("leaves slash commands to the dedicated command menu", () => {
    expect(
      matchTypeahead({ draft: "/", caret: 1, workers: [], workflows: [], repos: [] }),
    ).toBeNull();
  });

  test("matches @runtime at start, middle, and end token boundaries", () => {
    const start = matchTypeahead({
      draft: "@co",
      caret: 3,
      workers: [],
      workflows: [],
      repos: [],
    });
    expect(start?.kind).toBe("runtime");
    expect(start?.items.map((item) => item.id)).toContain("codex");
    expect(start?.items.find((item) => item.id === "codex")?.insertText).toBe("Codex ");

    const middle = matchTypeahead({
      draft: "please @cl fix this",
      caret: 10,
      workers: [],
      workflows: [],
      repos: [],
    });
    expect(middle?.items.map((item) => item.id)).toContain("claude");
    expect(middle?.tokenStart).toBe(7);

    const end = matchTypeahead({
      draft: "ship @",
      caret: 6,
      workers: [],
      workflows: [],
      repos: [],
    });
    const endIds = end?.items.map((item) => item.id) ?? [];
    for (const id of ["claude", "codex", "grok", "opencode", "pi", "omp"]) {
      expect(endIds).toContain(id);
    }

    // Embedded mid-word runtime sigil is not a token boundary.
    expect(
      matchTypeahead({ draft: "use@codex", caret: 9, workers: [], workflows: [], repos: [] }),
    ).toBeNull();
  });
});
