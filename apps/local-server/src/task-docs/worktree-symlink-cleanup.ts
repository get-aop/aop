import { existsSync, lstatSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { RepoRepository } from "../repo/repository.ts";

const TASK_DOCS_SEGMENT = join("docs", "tasks");

/** Removes legacy task-doc symlinks from a worktree after switching to .aop storage. */
export const cleanupStaleTaskDocSymlinksInWorktree = async (
  worktreePath: string,
  changePath: string,
): Promise<void> => {
  const linkPath = join(worktreePath, changePath);
  if (!existsSync(linkPath)) return;

  const stat = lstatSync(linkPath);
  if (!stat.isSymbolicLink()) return;

  await rm(linkPath, { recursive: true, force: true });
};

const removeSymlinksInTaskDocsRoot = async (taskDocsRoot: string): Promise<number> => {
  let removed = 0;

  for (const taskEntry of readdirSync(taskDocsRoot, { withFileTypes: true })) {
    const candidate = join(taskDocsRoot, taskEntry.name);
    if (!existsSync(candidate) || !lstatSync(candidate).isSymbolicLink()) continue;
    await rm(candidate, { recursive: true, force: true });
    removed++;
  }

  return removed;
};

const removeSymlinksInRepoWorktrees = async (repoWorktreesRoot: string): Promise<number> => {
  let removed = 0;

  for (const entry of readdirSync(repoWorktreesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".metadata") continue;

    const taskDocsRoot = join(repoWorktreesRoot, entry.name, TASK_DOCS_SEGMENT);
    if (!existsSync(taskDocsRoot)) continue;

    removed += await removeSymlinksInTaskDocsRoot(taskDocsRoot);
  }

  return removed;
};

export const cleanupStaleWorktreeTaskDocSymlinks = async (
  repoRepository: RepoRepository,
): Promise<number> => {
  let removed = 0;
  const repos = await repoRepository.getAll();

  for (const repo of repos) {
    const repoWorktreesRoot = aopPaths.worktrees(repo.id);
    if (!existsSync(repoWorktreesRoot)) continue;
    removed += await removeSymlinksInRepoWorktrees(repoWorktreesRoot);
  }

  return removed;
};
