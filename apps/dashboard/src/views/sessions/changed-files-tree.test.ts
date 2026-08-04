import { describe, expect, it } from "bun:test";
import type { SessionDiffFile } from "@aop/common";
import {
  buildChangedFilesTree,
  type ChangedFilesDirectoryNode,
  collectDirectoryPaths,
  summarizeChangedFilesStats,
} from "./changed-files-tree";

const file = (path: string, additions = 1, deletions = 0): SessionDiffFile => ({
  path,
  oldPath: null,
  status: "modified",
  additions,
  deletions,
  truncated: false,
  hunks: [],
});

describe("summarizeChangedFilesStats", () => {
  it("sums additions and deletions across files", () => {
    const totals = summarizeChangedFilesStats([
      file("a.ts", 10, 2),
      file("b.ts", 5, 3),
      file("c.ts", 0, 0),
    ]);
    expect(totals).toEqual({ additions: 15, deletions: 5 });
  });

  it("returns zeros for an empty list", () => {
    expect(summarizeChangedFilesStats([])).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("buildChangedFilesTree", () => {
  it("nests files under their directories with aggregated stats", () => {
    const tree = buildChangedFilesTree([
      file("apps/dashboard/src/a.ts", 10, 1),
      file("apps/dashboard/src/b.ts", 5, 2),
      file("README.md", 3, 0),
    ]);
    const rootDir = tree.find((node) => node.kind === "directory") as ChangedFilesDirectoryNode;
    expect(rootDir.name).toBe("apps/dashboard/src");
    expect(rootDir.stat).toEqual({ additions: 15, deletions: 3 });
    expect(rootDir.children.map((child) => child.name)).toEqual(["a.ts", "b.ts"]);
    const rootFile = tree.find((node) => node.kind === "file");
    expect(rootFile?.name).toBe("README.md");
  });

  it("keeps branching directory levels un-compacted", () => {
    const tree = buildChangedFilesTree([file("apps/web/a.ts", 1, 0), file("apps/cli/b.ts", 2, 0)]);
    const apps = tree.find((node) => node.kind === "directory") as ChangedFilesDirectoryNode;
    expect(apps.name).toBe("apps");
    const childNames = apps.children.map((child) => child.name);
    expect(childNames).toContain("web");
    expect(childNames).toContain("cli");
  });

  it("sorts directories before files and by name", () => {
    const tree = buildChangedFilesTree([file("z.ts"), file("m/a.ts"), file("a.ts")]);
    expect(tree.map((node) => node.name)).toEqual(["m", "a.ts", "z.ts"]);
  });

  it("collects every directory path for expansion state", () => {
    const tree = buildChangedFilesTree([file("a/b/c/x.ts"), file("a/d/y.ts")]);
    const paths = collectDirectoryPaths(tree);
    expect(paths).toContain("a");
    expect(paths).toContain("a/d");
    expect(paths.some((path) => path.includes("b/c"))).toBe(true);
  });
});
