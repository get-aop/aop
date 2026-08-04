import { basename, join } from "node:path";
import { aopPaths } from "@aop/infra";

const TASKS_ROOT = aopPaths.relativeTaskDocs();
const STAGED_TASKS_ROOT = join(TASKS_ROOT, ".drafts");

const getStagedChangePath = (changePath: string): string =>
  join(STAGED_TASKS_ROOT, basename(changePath));

export const getPublishedTaskDir = (
  repoId: string,
  _repoPath: string,
  changePath: string,
): string => aopPaths.repoTask(repoId, basename(changePath));

export const getStagedTaskDir = (_repoId: string, repoPath: string, changePath: string): string =>
  join(repoPath, getStagedChangePath(changePath));
