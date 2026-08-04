import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { aopPaths } from "@aop/infra";
import { TASK_SPEC_DOC_PATHS } from "./types.ts";

const RESERVED_FOLDERS = new Set([".drafts", "archive"]);
const TASK_DOCS_ROOT = aopPaths.relativeTaskDocs();

export const toTaskId = (taskIdOrChangePath: string): string => {
  if (taskIdOrChangePath === TASK_DOCS_ROOT) {
    return "";
  }

  if (taskIdOrChangePath.startsWith(`${TASK_DOCS_ROOT}/`)) {
    return taskIdOrChangePath.slice(TASK_DOCS_ROOT.length + 1);
  }

  return taskIdOrChangePath;
};

export const toLegacyTaskChangePath = (taskIdOrChangePath: string): string => {
  const taskId = toTaskId(taskIdOrChangePath);
  return taskId ? join(TASK_DOCS_ROOT, taskId) : TASK_DOCS_ROOT;
};

export const getCanonicalTaskDocsRoot = (repoId: string): string => aopPaths.repoTasks(repoId);

export const getCanonicalTaskDir = (repoId: string, taskIdOrChangePath: string): string =>
  aopPaths.repoTask(repoId, toTaskId(taskIdOrChangePath));

export const getLegacyTaskDocsRoot = (repoPath: string): string => join(repoPath, TASK_DOCS_ROOT);

export const getLegacyTaskDir = (repoPath: string, taskIdOrChangePath: string): string =>
  join(repoPath, toLegacyTaskChangePath(taskIdOrChangePath));

/** Absolute path to canonical or legacy task docs, preferring `.aop` when present. */
export const resolveTaskDir = (
  repoId: string,
  repoPath: string,
  taskIdOrChangePath: string,
): string => {
  const canonicalDir = getCanonicalTaskDir(repoId, taskIdOrChangePath);
  if (existsSync(join(canonicalDir, "task.md"))) {
    return canonicalDir;
  }

  for (const candidate of buildLegacyTaskDirCandidates(repoId, repoPath, taskIdOrChangePath)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return canonicalDir;
};

export const resolveTaskDocsPath = resolveTaskDir;

export const resolveTaskFilePath = (
  repoId: string,
  repoPath: string,
  taskIdOrChangePath: string,
  filename = "task.md",
): string => join(resolveTaskDir(repoId, repoPath, taskIdOrChangePath), filename);

export const taskDocsExistOnDisk = (
  repoId: string,
  repoPath: string,
  taskIdOrChangePath: string,
): boolean => {
  const taskDir = resolveTaskDir(repoId, repoPath, taskIdOrChangePath);
  return TASK_SPEC_DOC_PATHS.some((filename) => existsSync(join(taskDir, filename)));
};

export const listCanonicalTaskIdsOnDisk = (repoId: string): string[] =>
  collectTaskIds(getCanonicalTaskDocsRoot(repoId));

export const listLegacyTaskIdsOnDisk = (repoPath: string): string[] =>
  collectTaskIds(getLegacyTaskDocsRoot(repoPath));

export const listTaskIdsOnDisk = (
  repoId: string,
  repoPath: string,
  options?: { includeLegacyRepoTasks?: boolean },
): string[] => {
  const canonicalTaskIds = listCanonicalTaskIdsOnDisk(repoId);
  if (options?.includeLegacyRepoTasks !== true) {
    return canonicalTaskIds;
  }

  const legacyTaskIds = listLegacyTaskIdsOnDisk(repoPath).filter(
    (taskId) => !canonicalTaskIds.includes(taskId),
  );

  return [...canonicalTaskIds, ...legacyTaskIds].sort();
};

const collectTaskIds = (root: string, prefix = ""): string[] => {
  if (!existsSync(root)) {
    return [];
  }

  try {
    const entries = readdirSync(root, { withFileTypes: true });
    const hasTaskDoc = entries.some((entry) => entry.isFile() && entry.name === "task.md");
    if (prefix && hasTaskDoc) {
      return [prefix];
    }

    return entries.flatMap((entry) => {
      if (!entry.isDirectory() || RESERVED_FOLDERS.has(entry.name)) {
        return [];
      }

      const nextPrefix = prefix ? join(prefix, entry.name) : entry.name;
      return collectTaskIds(join(root, entry.name), nextPrefix);
    });
  } catch {
    return [];
  }
};

const buildLegacyTaskDirCandidates = (
  repoId: string,
  repoPath: string,
  taskIdOrChangePath: string,
): string[] => {
  const candidates = [getLegacyTaskDir(repoPath, taskIdOrChangePath)];
  const fallbackId = basename(taskIdOrChangePath);

  if (fallbackId && fallbackId !== taskIdOrChangePath) {
    candidates.push(getLegacyTaskDir(repoPath, fallbackId));
  }

  if (!candidates.includes(getCanonicalTaskDir(repoId, taskIdOrChangePath))) {
    candidates.unshift(getCanonicalTaskDir(repoId, taskIdOrChangePath));
  }

  return [...new Set(candidates)];
};
