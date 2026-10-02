import type { PullRequestViewFile } from "@aop/common";

/**
 * A file with more changed lines than this starts folded behind "Load diff", as GitHub folds its
 * large diffs: highlighting tens of thousands of lines at once is what freezes a page.
 */
export const LARGE_FILE_LINES = 1_000;

/** Above this many files, every file starts folded and opens one at a time from the tree or its header. */
export const MANY_FILES = 300;

export const isLargeFile = (file: Pick<PullRequestViewFile, "additions" | "deletions">): boolean =>
  file.additions + file.deletions > LARGE_FILE_LINES;

/**
 * GitHub's REST answer holds only a file's hunks; the diff renderer reads a whole patch, so the
 * header git would have written goes in front: the old and new names, `/dev/null` for a side
 * that does not exist.
 */
export const patchOf = (file: PullRequestViewFile): string | null => {
  if (file.patch === null) return null;
  const oldName = file.previousPath ?? file.path;
  const from = file.status === "added" ? "/dev/null" : `a/${oldName}`;
  const to = file.status === "removed" ? "/dev/null" : `b/${file.path}`;
  return `diff --git a/${oldName} b/${file.path}\n--- ${from}\n+++ ${to}\n${file.patch}\n`;
};

/** A folder or a file of the tree beside the diff. */
export type FileTreeNode =
  | { kind: "dir"; name: string; path: string; children: FileTreeNode[] }
  | { kind: "file"; name: string; path: string; file: PullRequestViewFile };

/**
 * The changed files as a tree, folders first then files, each by name. A folder that holds only
 * one folder is joined to it ("apps/dashboard/src"), as GitHub's file tree does.
 */
export const fileTreeOf = (files: readonly PullRequestViewFile[]): FileTreeNode[] => {
  const root: FileTreeNode & { kind: "dir" } = { kind: "dir", name: "", path: "", children: [] };
  for (const file of files) insert(root, file.path.split("/"), file);
  return root.children.map(compact).sort(byKindThenName);
};

const insert = (
  dir: FileTreeNode & { kind: "dir" },
  parts: string[],
  file: PullRequestViewFile,
) => {
  const [head, ...rest] = parts;
  if (head === undefined) return;
  if (rest.length === 0) {
    dir.children.push({ kind: "file", name: head, path: file.path, file });
    return;
  }
  const path = dir.path ? `${dir.path}/${head}` : head;
  let child = dir.children.find(
    (node): node is FileTreeNode & { kind: "dir" } => node.kind === "dir" && node.name === head,
  );
  if (!child) {
    child = { kind: "dir", name: head, path, children: [] };
    dir.children.push(child);
  }
  insert(child, rest, file);
};

const compact = (node: FileTreeNode): FileTreeNode => {
  if (node.kind === "file") return node;
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (only?.kind === "dir") return compact({ ...only, name: `${node.name}/${only.name}` });
  return { ...node, children: node.children.map(compact).sort(byKindThenName) };
};

const byKindThenName = (a: FileTreeNode, b: FileTreeNode): number =>
  a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1;

/** The files in the order the tree lists them, so the diff reads top to bottom like the tree. */
export const filesInTreeOrder = (nodes: readonly FileTreeNode[]): PullRequestViewFile[] =>
  nodes.flatMap((node) => (node.kind === "file" ? [node.file] : filesInTreeOrder(node.children)));

/** A stable id for a file's section, so the tree can scroll to it. */
export const fileAnchor = (path: string): string => `pr-file-${encodeURIComponent(path)}`;
