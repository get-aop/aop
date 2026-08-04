/**
 * Builds a nested directory tree from a flat changed-file list.
 * Ported from t3code apps/web/src/lib/turnDiffTree.ts — same shape and
 * single-child-directory compaction, adapted to AOP's SessionDiffFile.
 */
import type { SessionDiffFile } from "@aop/common";

export interface ChangedFilesStat {
  additions: number;
  deletions: number;
}

export interface ChangedFilesDirectoryNode {
  kind: "directory";
  name: string;
  path: string;
  stat: ChangedFilesStat;
  children: ChangedFilesTreeNode[];
}

export interface ChangedFilesFileNode {
  kind: "file";
  name: string;
  path: string;
  file: SessionDiffFile;
}

export type ChangedFilesTreeNode = ChangedFilesDirectoryNode | ChangedFilesFileNode;

interface MutableDirectoryNode {
  name: string;
  path: string;
  stat: ChangedFilesStat;
  directories: Map<string, MutableDirectoryNode>;
  files: ChangedFilesFileNode[];
}

const SORT_LOCALE_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

const compareByName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, SORT_LOCALE_OPTIONS);

const compactDirectoryNode = (node: ChangedFilesDirectoryNode): ChangedFilesDirectoryNode => {
  const compactedChildren = node.children.map((child) =>
    child.kind === "directory" ? compactDirectoryNode(child) : child,
  );
  let compacted: ChangedFilesDirectoryNode = { ...node, children: compactedChildren };
  while (compacted.children.length === 1 && compacted.children[0]?.kind === "directory") {
    const onlyChild = compacted.children[0];
    compacted = {
      kind: "directory",
      name: `${compacted.name}/${onlyChild.name}`,
      path: onlyChild.path,
      stat: onlyChild.stat,
      children: onlyChild.children,
    };
  }
  return compacted;
};

const toTreeNodes = (directory: MutableDirectoryNode): ChangedFilesTreeNode[] => {
  const subdirectories: ChangedFilesDirectoryNode[] = Array.from(directory.directories.values())
    .toSorted(compareByName)
    .map<ChangedFilesDirectoryNode>((subdirectory) => ({
      kind: "directory",
      name: subdirectory.name,
      path: subdirectory.path,
      stat: { ...subdirectory.stat },
      children: toTreeNodes(subdirectory),
    }))
    .map((subdirectory) => compactDirectoryNode(subdirectory));
  const files = directory.files.toSorted(compareByName);
  return [...subdirectories, ...files];
};

export const summarizeChangedFilesStats = (files: SessionDiffFile[]): ChangedFilesStat =>
  files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

export const buildChangedFilesTree = (files: SessionDiffFile[]): ChangedFilesTreeNode[] => {
  const root: MutableDirectoryNode = {
    name: "",
    path: "",
    stat: { additions: 0, deletions: 0 },
    directories: new Map(),
    files: [],
  };
  for (const file of files) {
    const segments = file.path
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;
    let current = root;
    current.stat.additions += file.additions;
    current.stat.deletions += file.deletions;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index] ?? "";
      let next = current.directories.get(segment);
      if (!next) {
        next = {
          name: segment,
          path: segments.slice(0, index + 1).join("/"),
          stat: { additions: 0, deletions: 0 },
          directories: new Map(),
          files: [],
        };
        current.directories.set(segment, next);
      }
      next.stat.additions += file.additions;
      next.stat.deletions += file.deletions;
      current = next;
    }
    current.files.push({
      kind: "file",
      name: segments[segments.length - 1] ?? file.path,
      path: file.path,
      file,
    });
  }
  return toTreeNodes(root);
};

export const collectDirectoryPaths = (nodes: ChangedFilesTreeNode[]): string[] => {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
};
