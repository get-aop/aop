/** `repository` has a git directory of its own; `worktree` is a linked worktree of another checkout. */
export type GitFolderKind = "repository" | "worktree";

/** One folder as the Attach repository dialog browses it (GET /api/fs/directories). */
export interface DirectoryListing {
  path: string;
  directories: string[];
  parent: string | null;
  /** The subfolders that are git repositories (or linked worktrees), by name. */
  gitFolders: Record<string, GitFolderKind>;
  /** What this folder itself is to git; a repository or a linked worktree can be attached, `null` cannot. */
  gitKind: GitFolderKind | null;
  /** When this folder is a linked worktree: the main repository that owns it, if it has a checkout. */
  worktreeOf: string | null;
}
