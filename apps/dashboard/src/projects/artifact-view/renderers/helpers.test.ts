import { describe, expect, test } from "bun:test";
import { fencedCode } from "./code-fence";
import { parseCsv } from "./csv";
import { HTML_ARTIFACT_CSP, HTML_ARTIFACT_SANDBOX, htmlArtifactDocument } from "./html-frame";
import { formatJsonPath, pathKey, pathsToDepth, searchJson } from "./json-path";
import { diffLines, diffStats } from "./line-diff";

describe("parseCsv", () => {
  test("reads quoted fields with delimiters, newlines and doubled quotes, and pads short rows", () => {
    const parsed = parseCsv('name,notes\r\n"Doe, J","said ""hi""\nthen left"\nSolo\n');
    expect(parsed).toEqual({
      header: ["name", "notes"],
      rows: [
        ["Doe, J", 'said "hi"\nthen left'],
        ["Solo", ""],
      ],
      omitted: 0,
    });
  });

  test("detects tabs and semicolons, and caps the rows it draws", () => {
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a;b\n1;2").header).toEqual(["a", "b"]);
    const big = parseCsv(["h", "1", "2", "3"].join("\n"), 2);
    expect(big.rows).toEqual([["1"], ["2"]]);
    expect(big.omitted).toBe(1);
  });
});

describe("json paths", () => {
  test("formats identifiers with dots and anything else bracketed", () => {
    expect(formatJsonPath(["items", 3, "name"])).toBe("$.items[3].name");
    expect(formatJsonPath(["a b", "x-y"])).toBe('$["a b"]["x-y"]');
    expect(formatJsonPath([])).toBe("$");
  });

  test("search finds keys and values and opens every container above them", () => {
    const value = { users: [{ name: "Ada" }, { name: "Linus" }], count: 2 };
    const { matches, open } = searchJson(value, "lin");
    expect([...matches]).toEqual([pathKey(["users", 1, "name"])]);
    expect(open).toEqual(new Set([pathKey([]), pathKey(["users"]), pathKey(["users", 1])]));
    expect(searchJson(value, "count").matches).toEqual(new Set([pathKey(["count"])]));
    expect(searchJson(value, " ").matches.size).toBe(0);
  });

  test("opens containers down to a depth", () => {
    const value = { a: { b: { c: 1 } }, d: [1] };
    expect(pathsToDepth(value, 1)).toEqual(new Set([pathKey([]), pathKey(["a"]), pathKey(["d"])]));
  });
});

describe("diffLines", () => {
  test("keeps what both have and marks what went and came, with line numbers", () => {
    const lines = diffLines("a\nb\nc", "a\nc\nd");
    expect(lines).toEqual([
      { type: "same", text: "a", before: 1, after: 1 },
      { type: "removed", text: "b", before: 2 },
      { type: "same", text: "c", before: 3, after: 2 },
      { type: "added", text: "d", after: 3 },
    ]);
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1 });
    expect(diffLines("", "x")).toEqual([{ type: "added", text: "x", after: 1 }]);
  });
});

describe("htmlArtifactDocument", () => {
  test("puts the policy first in the head of a page, or wraps a fragment in one", () => {
    const page = htmlArtifactDocument(
      '<html><head><script src="https://x"></script></head></html>',
    );
    expect(page.indexOf(HTML_ARTIFACT_CSP)).toBeLessThan(page.indexOf("<script"));
    const fragment = htmlArtifactDocument("<p>hi</p>");
    expect(fragment).toContain(`content="${HTML_ARTIFACT_CSP}"`);
    expect(fragment).toContain("<body><p>hi</p></body>");
    expect(HTML_ARTIFACT_CSP).toContain("default-src 'none'");
    expect(HTML_ARTIFACT_CSP).not.toContain("connect-src");
    expect(HTML_ARTIFACT_SANDBOX).not.toContain("allow-same-origin");
  });
});

describe("fencedCode", () => {
  test("uses a fence longer than any backticks inside", () => {
    expect(fencedCode("x = 1\n", "python")).toBe("```python\nx = 1\n```");
    expect(fencedCode("a ```` b", null)).toBe("`````\na ```` b\n`````");
  });
});
