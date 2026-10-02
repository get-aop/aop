import { describe, expect, test } from "bun:test";
import { getSingularPatch } from "@pierre/diffs";
import { filesInTreeOrder, fileTreeOf, isLargeFile, LARGE_FILE_LINES, patchOf } from "./diff-files";
import { makeFile } from "./test-utils";

describe("patchOf", () => {
  test("puts git's header in front of GitHub's hunks, so the renderer reads one file", () => {
    const parsed = getSingularPatch(patchOf(makeFile()) ?? "");
    expect(parsed.name).toBe("src/impacts.ts");
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.additionLines.length + parsed.deletionLines.length).toBeGreaterThan(0);
  });

  test("an added file comes from /dev/null, a removed one goes to it, a rename keeps both names", () => {
    expect(patchOf(makeFile({ status: "added" }))).toContain("--- /dev/null\n+++ b/src/impacts.ts");
    expect(patchOf(makeFile({ status: "removed" }))).toContain(
      "--- a/src/impacts.ts\n+++ /dev/null",
    );
    const renamed = patchOf(makeFile({ status: "renamed", previousPath: "src/old.ts" })) ?? "";
    expect(renamed).toStartWith("diff --git a/src/old.ts b/src/impacts.ts\n--- a/src/old.ts");
  });

  test("a file GitHub sent no patch for (binary, too large) has none", () => {
    expect(patchOf(makeFile({ patch: null }))).toBeNull();
  });
});

test("a file is large past LARGE_FILE_LINES changed lines", () => {
  expect(isLargeFile({ additions: LARGE_FILE_LINES, deletions: 0 })).toBe(false);
  expect(isLargeFile({ additions: LARGE_FILE_LINES, deletions: 1 })).toBe(true);
});

describe("fileTreeOf", () => {
  const files = [
    "apps/dashboard/src/b.ts",
    "apps/dashboard/src/a.ts",
    "README.md",
    "apps/server/index.ts",
    "apps/dashboard/src/deep/c.ts",
  ].map((path) => makeFile({ path }));

  test("folders first, then files, by name; a folder holding one folder joins it", () => {
    const tree = fileTreeOf(files);
    const shape = (nodes: ReturnType<typeof fileTreeOf>): unknown[] =>
      nodes.map((node) =>
        node.kind === "file" ? node.name : { [node.name]: shape(node.children) },
      );
    expect(shape(tree)).toEqual([
      {
        apps: [{ "dashboard/src": [{ deep: ["c.ts"] }, "a.ts", "b.ts"] }, { server: ["index.ts"] }],
      },
      "README.md",
    ]);
  });

  test("the diff lists files in the tree's order", () => {
    expect(filesInTreeOrder(fileTreeOf(files)).map((file) => file.path)).toEqual([
      "apps/dashboard/src/deep/c.ts",
      "apps/dashboard/src/a.ts",
      "apps/dashboard/src/b.ts",
      "apps/server/index.ts",
      "README.md",
    ]);
  });
});
