import { existsSync } from "node:fs";
import { join } from "node:path";
import { TaskStatus } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { resolveTaskDir } from "../task-docs/paths.ts";
import { listSubtaskDocs } from "../task-docs/subtask.ts";
import {
  markAcceptanceCriterionChecked,
  parseTaskDoc,
  TASK_IMPLEMENTATION_ACCEPTANCE_CRITERION,
} from "../task-docs/task.ts";

export type CompletionGuardResult =
  | { ok: true }
  | { ok: false; message: string; reasons: string[] };

export const markGeneratedCompletionCriterionChecked = async (
  ctx: LocalServerContext,
  task: Task,
): Promise<boolean> => {
  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) return false;

  const taskFilePath = join(resolveTaskDir(task.repo_id, repo.path, task.change_path), "task.md");
  return markAcceptanceCriterionChecked(taskFilePath, TASK_IMPLEMENTATION_ACCEPTANCE_CRITERION);
};

export const validateTaskCompletion = async (
  ctx: LocalServerContext,
  task: Task,
): Promise<CompletionGuardResult> => {
  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    return buildFailure([`Repo not found: ${task.repo_id}`]);
  }

  const taskDir = resolveTaskDir(task.repo_id, repo.path, task.change_path);
  const taskFilePath = join(taskDir, "task.md");
  if (!existsSync(taskFilePath)) {
    return buildFailure([`Task document missing: ${taskFilePath}`]);
  }

  const taskDoc = await parseTaskDoc(taskFilePath);
  const subtasks = await listSubtaskDocs(taskDir);
  const unfinishedSubtasks = subtasks.filter((subtask) => subtask.status !== TaskStatus.DONE);
  const uncheckedCriteria = taskDoc.acceptanceCriteria.filter((criterion) => !criterion.checked);
  const reasons: string[] = [];

  if (uncheckedCriteria.length > 0) {
    reasons.push(
      `${uncheckedCriteria.length} unchecked acceptance ${pluralize(
        uncheckedCriteria.length,
        "criterion",
        "criteria",
      )}: ${summarizeItems(uncheckedCriteria.map((criterion) => criterion.text))}`,
    );
  }

  if (unfinishedSubtasks.length > 0) {
    reasons.push(
      `${unfinishedSubtasks.length} unfinished subtask ${pluralize(
        unfinishedSubtasks.length,
        "doc",
        "docs",
      )}: ${summarizeItems(
        unfinishedSubtasks.map((subtask) => `${subtask.filename} (${subtask.status})`),
      )}`,
    );
  }

  return reasons.length > 0 ? buildFailure(reasons) : { ok: true };
};

const buildFailure = (reasons: string[]): CompletionGuardResult => ({
  ok: false,
  reasons,
  message: reasons.join("; "),
});

const pluralize = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

const summarizeItems = (items: string[]): string => {
  const visibleItems = items.slice(0, 3);
  const suffix =
    items.length > visibleItems.length ? `, +${items.length - visibleItems.length} more` : "";
  return `${visibleItems.join(", ")}${suffix}`;
};
