import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { extractMarkdownFileRefs, resolveMarkdownFilePath } from "./markdown-file-refs";

describe("resolveMarkdownFilePath", () => {
  test("resolves changed-file paths against the session workspace", () => {
    expect(resolveMarkdownFilePath("notes.md", "/repo/worktree")).toBe("/repo/worktree/notes.md");
    expect(resolveMarkdownFilePath("/repo/worktree/notes.md", "/repo/worktree")).toBe(
      "/repo/worktree/notes.md",
    );
  });

  test("ignores non-Markdown changed files", () => {
    expect(resolveMarkdownFilePath("src/index.ts", "/repo/worktree")).toBeNull();
  });
});

describe("extractMarkdownFileRefs", () => {
  test("resolves relative markdown references against the repository", () => {
    expect(extractMarkdownFileRefs("See `.aop/plans/x.md`.", "/repo")).toEqual([
      { path: "/repo/.aop/plans/x.md", fileName: "x.md", dir: ".aop/plans" },
    ]);
  });

  test("extracts absolute, tilde, backticked, and linked references", () => {
    const repoPath = "/repo";
    const absolutePath = path.join(repoPath, "README.md");

    expect(
      extractMarkdownFileRefs(
        `Read [the plan](.aop/plans/plan.md), \`docs/guide.md\`, ${absolutePath}, and ~/notes.md.`,
        repoPath,
      ),
    ).toEqual([
      { path: "/repo/.aop/plans/plan.md", fileName: "plan.md", dir: ".aop/plans" },
      { path: "/repo/docs/guide.md", fileName: "guide.md", dir: "docs" },
      { path: absolutePath, fileName: "README.md", dir: "." },
      {
        path: path.join(os.homedir(), "notes.md"),
        fileName: "notes.md",
        dir: `../${path.relative("/", os.homedir())}`,
      },
    ]);
  });

  test("strips punctuation, deduplicates paths, and caps results at four", () => {
    const refs = extractMarkdownFileRefs(
      "one.md, one.md; two.md! three.md? four.md five.md six.txt",
      "/repo",
    );

    expect(refs.map((ref) => ref.path)).toEqual([
      "/repo/one.md",
      "/repo/two.md",
      "/repo/three.md",
      "/repo/four.md",
    ]);
  });

  test("skips relative references without a repository and ignores web URLs", () => {
    expect(extractMarkdownFileRefs("relative.md https://example.com/guide.md", null)).toEqual([]);
    expect(extractMarkdownFileRefs("relative.md https://example.com/guide.md", "/repo")).toEqual([
      { path: "/repo/relative.md", fileName: "relative.md", dir: "." },
    ]);
  });

  test("does not treat a backticked editor command as a Markdown file", () => {
    expect(
      extractMarkdownFileRefs(
        "Open it with `code presentation-prep.rfc-utility-ingestion.md`.",
        "/repo",
      ),
    ).toEqual([]);
  });
});
