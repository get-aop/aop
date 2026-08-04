import { resolveTaskSwimlane, type TaskSwimlane } from "@aop/common";
import type { Task } from "../db/schema.ts";
import { resolveTaskFilePath } from "../task-docs/paths.ts";
import { readTaskExecutionModel } from "../task-docs/task.ts";

type SwimlaneTask = Pick<Task, "repo_id" | "change_path" | "status">;

export const readTaskSwimlaneMetadata = async (
  repoPath: string,
  task: SwimlaneTask,
): Promise<TaskSwimlane> => {
  const execution = await readTaskExecutionModel(
    resolveTaskFilePath(task.repo_id, repoPath, task.change_path),
  ).catch(() => ({ model: null, error: null }));
  return resolveTaskSwimlane(task.status, execution.model);
};
