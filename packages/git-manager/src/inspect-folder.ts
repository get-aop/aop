import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { GitFolderKind } from "@aop/common";

/**
 * What a folder is to git, judged from the files on disk (no git process, so a directory listing
 * can ask it for every entry):
 * - `repository`: `.git` is a directory, or a file pointing at a git directory of its own (a submodule);
 * - `worktree`: `.git` is a file pointing at a linked worktree's git directory;
 * - `null`: not a repository root, including a `.git` file whose target is gone.
 */
export interface GitFolder {
  kind: GitFolderKind | null;
  /** For a linked worktree: the checkout that owns its git directory, when it has one (not a bare repository). */
  mainRepoPath: string | null;
}

const NOT_GIT: GitFolder = { kind: null, mainRepoPath: null };

export const inspectGitFolder = async (folder: string): Promise<GitFolder> => {
  const dotGit = join(folder, ".git");
  const entry = await stat(dotGit).catch(() => null);
  if (!entry) return NOT_GIT;
  if (entry.isDirectory()) return (await hasHead(dotGit)) ? repository() : NOT_GIT;
  if (!entry.isFile()) return NOT_GIT;

  const gitDir = await readGitDirPointer(folder, dotGit);
  if (!gitDir || !(await hasHead(gitDir))) return NOT_GIT;
  const commonDir = await readCommonDir(gitDir);
  if (!commonDir) return repository();
  return {
    kind: "worktree",
    mainRepoPath: basename(commonDir) === ".git" ? dirname(commonDir) : null,
  };
};

const repository = (): GitFolder => ({ kind: "repository", mainRepoPath: null });

// A git directory without HEAD is not one git will open: an emptied `.git` folder, or a pointer
// left behind by a repository that was moved or deleted.
const hasHead = async (gitDir: string): Promise<boolean> =>
  (await stat(join(gitDir, "HEAD")).catch(() => null))?.isFile() ?? false;

/** The directory named by a `gitdir: <path>` file, which may be relative to the folder. */
const readGitDirPointer = async (folder: string, dotGitFile: string): Promise<string | null> => {
  const content = await readFile(dotGitFile, "utf8").catch(() => "");
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(content);
  if (!match?.[1]) return null;
  return isAbsolute(match[1]) ? match[1] : resolve(folder, match[1]);
};

// Only a linked worktree's git directory has `commondir`; it names the git directory it shares.
const readCommonDir = async (gitDir: string): Promise<string | null> => {
  const content = await readFile(join(gitDir, "commondir"), "utf8").catch(() => null);
  const value = content?.trim();
  if (!value) return null;
  return resolve(gitDir, value);
};
