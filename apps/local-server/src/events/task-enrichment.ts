import type { LocalServerContext } from "../context.ts";
import { toSSETask } from "../status/handlers.ts";
import { readTaskSwimlaneMetadata } from "../status/swimlane-metadata.ts";
import type { TaskEvent } from "./task-events.ts";

type TaskPayloadEvent = Extract<TaskEvent, { task: unknown }>;

const hasTaskPayload = (event: TaskEvent): event is TaskPayloadEvent => "task" in event;

/**
 * Fills the live projection fields (execution, dependency state, swimlane) the
 * repository event carried only as ids. Runs once per emitted event, not once
 * per connected SSE client.
 */
export const enrichTaskEvent = async (
  ctx: LocalServerContext,
  event: TaskEvent,
): Promise<TaskEvent> => {
  if (!hasTaskPayload(event)) {
    return event;
  }

  const repo = await ctx.repoRepository.getById(event.task.repoId);
  const task = await ctx.taskRepository.get(event.task.id);
  if (!repo || !task) {
    return event;
  }

  const executions = await ctx.executionRepository.getExecutionsByTaskId(task.id);
  const execution = executions.find((candidate) => candidate.status === "running") ?? executions[0];
  const dependencyState = await ctx.taskRepository.getDependencyState(task.id);
  const swimlane = await readTaskSwimlaneMetadata(repo.path, task);

  return {
    ...event,
    task: toSSETask(task, execution, repo.path, dependencyState, swimlane),
  };
};
