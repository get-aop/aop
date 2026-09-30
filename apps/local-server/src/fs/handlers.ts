import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DirectoryListing, GitFolderKind } from "@aop/common";
import { inspectGitFolder } from "@aop/git-manager";

export type DirectoryListingData = DirectoryListing;

export type ListDirectoriesResult =
  | { success: true; data: DirectoryListingData }
  | { success: false; error: ListDirectoriesError };

export type ListDirectoriesError =
  | { code: "NOT_FOUND"; path: string }
  | { code: "NOT_A_DIRECTORY"; path: string }
  | { code: "PERMISSION_DENIED"; path: string };

export interface ListDirectoriesOptions {
  hidden?: boolean;
}

/**
 * One folder for the Attach dialog: its subfolders, which of them are git repositories or linked
 * worktrees (so a person can see where to go), and what the folder itself is. A leading `~` is the
 * home folder, and the path in the answer is the one the server resolved, not the one typed.
 */
export const listDirectories = async (
  dirPath?: string,
  options: ListDirectoriesOptions = {},
): Promise<ListDirectoriesResult> => {
  const targetPath = resolveTarget(dirPath);
  const includeHidden = options.hidden ?? false;

  try {
    const stats = await stat(targetPath);

    if (!stats.isDirectory()) {
      return {
        success: false,
        error: { code: "NOT_A_DIRECTORY", path: targetPath },
      };
    }

    const entries = await readdir(targetPath, { withFileTypes: true });

    const directories = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => includeHidden || !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();

    const parent = targetPath === "/" ? null : path.dirname(targetPath);
    const [self, gitFolders] = await Promise.all([
      inspectGitFolder(targetPath),
      findGitFolders(targetPath, directories),
    ]);

    return {
      success: true,
      data: {
        path: targetPath,
        directories,
        parent,
        gitFolders,
        gitKind: self.kind,
        worktreeOf: self.kind === "worktree" ? self.mainRepoPath : null,
      },
    };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;

    if (nodeErr.code === "ENOENT") {
      return {
        success: false,
        error: { code: "NOT_FOUND", path: targetPath },
      };
    }

    if (nodeErr.code === "EACCES") {
      return {
        success: false,
        error: { code: "PERMISSION_DENIED", path: targetPath },
      };
    }

    throw err;
  }
};

const resolveTarget = (dirPath?: string): string => {
  if (!dirPath || dirPath === "~") return os.homedir();
  if (dirPath.startsWith("~/")) return path.join(os.homedir(), dirPath.slice(2));
  return path.resolve(dirPath);
};

const findGitFolders = async (
  parent: string,
  names: string[],
): Promise<Record<string, GitFolderKind>> => {
  const found = await Promise.all(
    names.map(async (name) => ({
      name,
      kind: (await inspectGitFolder(path.join(parent, name))).kind,
    })),
  );
  const gitFolders: Record<string, GitFolderKind> = {};
  for (const { name, kind } of found) {
    if (kind) gitFolders[name] = kind;
  }
  return gitFolders;
};
