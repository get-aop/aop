import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import { getServerStatus, toSSETask } from "../status/handlers.ts";
import { readTaskSwimlaneMetadata } from "../status/swimlane-metadata.ts";
import { createSSEStreamHelper } from "./sse-stream.ts";
import type { TaskEvent } from "./task-events.ts";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 3_000;

interface EventsSSEHandlerOptions {
  heartbeatIntervalMs?: number;
}

export const createEventsSSEHandler = (
  ctx: LocalServerContext,
  options: EventsSSEHandlerOptions = {},
) => {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  return async (c: Context) => {
    return streamSSE(c, async (stream) => {
      const sse = createSSEStreamHelper(stream);

      const enrichTaskEvent = async (event: TaskEvent): Promise<TaskEvent> => {
        if (!hasTaskPayload(event)) {
          return event;
        }
        return enrichTaskPayload(ctx, event);
      };

      // Subscribe BEFORE sending init to avoid missing events during setup
      const unsubscribeTasks = ctx.taskEventEmitter.subscribe(async (event: TaskEvent) => {
        await sse.sendEvent(event.type, await enrichTaskEvent(event));
      });
      sse.registerCleanup(unsubscribeTasks);

      const initialStatus = await getServerStatus(ctx);
      const initSent = await sse.sendEvent("init", { type: "init", status: initialStatus });
      if (!initSent) return;

      // Immediate heartbeat to detect fast disconnects (e.g., hot reload)
      const probeSent = await sse.sendRaw("heartbeat", "");
      if (!probeSent) return;

      const heartbeatInterval = setInterval(async () => {
        const sent = await sse.sendRaw("heartbeat", "");
        if (!sent) {
          clearInterval(heartbeatInterval);
        }
      }, heartbeatIntervalMs);
      sse.registerCleanup(() => clearInterval(heartbeatInterval));

      await new Promise(() => {});
    });
  };
};

type TaskPayloadEvent = Extract<TaskEvent, { task: unknown }>;

const hasTaskPayload = (event: TaskEvent): event is TaskPayloadEvent => "task" in event;

const enrichTaskPayload = async (
  ctx: LocalServerContext,
  event: TaskPayloadEvent,
): Promise<TaskEvent> => {
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
