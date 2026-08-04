import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTaskDir } from "../task-docs/paths.ts";

const CHECKED_RE = /^\s*-\s+\[[xX]\]\s/;
const UNCHECKED_RE = /^\s*-\s+\[ \]\s/;
const SUBTASK_RE = /^\d{3}-.*\.md$/;
const STATUS_RE = /^\s*status:\s*([A-Za-z_]+)\s*$/m;

export const parseTaskProgress = (content: string): { completed: number; total: number } => {
  let completed = 0;
  let total = 0;

  for (const line of content.split("\n")) {
    if (CHECKED_RE.test(line)) {
      completed++;
      total++;
    } else if (UNCHECKED_RE.test(line)) {
      total++;
    }
  }

  return { completed, total };
};

export const readTaskProgress = (
  repoId: string,
  repoPath: string,
  changePath: string,
): { completed: number; total: number } | undefined => {
  const taskDir = resolveTaskDir(repoId, repoPath, changePath);

  try {
    const subtaskFiles = readdirSync(taskDir)
      .filter((file) => SUBTASK_RE.test(file))
      .sort();

    if (subtaskFiles.length === 0) {
      return undefined;
    }

    let completed = 0;
    for (const file of subtaskFiles) {
      const content = readFileSync(join(taskDir, file), "utf-8");
      const status = content.match(STATUS_RE)?.[1]?.toUpperCase();
      if (status === "DONE") {
        completed++;
      }
    }

    return { completed, total: subtaskFiles.length };
  } catch {
    return undefined;
  }
};

const SPEC_DOC_FILES = ["plan.md", "issues.md", "prd.md"];

export const hasTaskSpec = (repoId: string, repoPath: string, changePath: string): boolean => {
  const taskDir = resolveTaskDir(repoId, repoPath, changePath);
  return SPEC_DOC_FILES.some((file) => existsSync(join(taskDir, file)));
};
