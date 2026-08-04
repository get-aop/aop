import type { DashboardSwimlane } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { getStatus } from "../api/client";
import { createTaskEventsConnection, type TaskEvent } from "../api/events";
import type { Task } from "../types";
import { receiveChatUnread } from "./use-chat-unread";
import { dashboardStatusUnchanged, refreshDashboardStatus } from "./useTaskEventsRefresh";

export interface TaskEventsState {
  tasks: Task[];
  swimlanes: DashboardSwimlane[];
  repos: { id: string; name: string | null; path: string }[];
  connected: boolean;
  initialized: boolean;
}

const WORKING_STATUS_POLL_INTERVAL_MS = 2000;

export const useTaskEvents = () => {
  const [state, setState] = useState<TaskEventsState>({
    tasks: [],
    swimlanes: [],
    repos: [],
    connected: false,
    initialized: false,
  });

  const connectionRef = useRef<{ close: () => void } | null>(null);
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    await refreshDashboardStatus({
      nextSeq: () => ++refreshSeqRef.current,
      getLatestSeq: () => refreshSeqRef.current,
      loadStatus: getStatus,
      applyStatus: (status) => {
        setState((prev) => {
          // Identical poll payloads must keep the previous state identity so the
          // app tree does not re-render every 2s while tasks are WORKING.
          if (dashboardStatusUnchanged(prev, status)) return prev;
          return {
            ...prev,
            tasks: status.tasks,
            swimlanes: status.swimlanes,
            repos: status.repos,
          };
        });
      },
    });
  }, []);

  const handleEvent = useCallback(
    (event: TaskEvent) => {
      switch (event.type) {
        case "init":
          setState((prev) => ({
            ...prev,
            tasks: event.data.tasks,
            swimlanes: event.data.swimlanes,
            repos: event.data.repos,
            initialized: true,
          }));
          break;

        case "task-created":
          setState((prev) => ({
            ...prev,
            tasks: [...prev.tasks, event.data.task],
          }));
          // Dependency wait state is derived across tasks, so refresh after mutations.
          void refresh().catch(() => {});
          break;

        case "task-status-changed":
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((task) =>
              task.id === event.data.taskId
                ? {
                    ...task,
                    status: event.data.status,
                    updatedAt: event.data.updatedAt,
                    errorMessage: event.data.errorMessage,
                    currentExecutionId: event.data.currentExecutionId,
                    executionStartedAt: event.data.executionStartedAt,
                    executionCompletedAt: event.data.executionCompletedAt,
                    taskProgress: event.data.taskProgress,
                    hasPlan: event.data.hasPlan,
                    swimlane: event.data.swimlane ?? task.swimlane,
                    boardColumn: event.data.boardColumn ?? task.boardColumn,
                    runtimeActivity: event.data.runtimeActivity ?? task.runtimeActivity,
                    completionMode: event.data.completionMode ?? task.completionMode,
                    assignedAgentRole: event.data.assignedAgentRole ?? task.assignedAgentRole,
                  }
                : task,
            ),
          }));
          // Dependency wait state is derived across tasks, so refresh after mutations.
          void refresh().catch(() => {});
          break;

        case "task-updated":
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((task) =>
              task.id === event.data.taskId
                ? { ...task, archivedAt: event.data.archivedAt, updatedAt: event.data.updatedAt }
                : task,
            ),
          }));
          break;

        case "task-removed":
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.filter((task) => task.id !== event.data.taskId),
          }));
          // Dependency wait state is derived across tasks, so refresh after mutations.
          void refresh().catch(() => {});
          break;

        case "repo-removed":
        case "data-reset":
          void refresh().catch(() => {});
          break;
        case "chat-unread":
          receiveChatUnread(event.data);
          break;
      }
    },
    [refresh],
  );

  const handleConnect = useCallback(() => {
    setState((prev) => ({ ...prev, connected: true }));
  }, []);

  const handleDisconnect = useCallback(() => {
    setState((prev) => ({ ...prev, connected: false }));
  }, []);

  useEffect(() => {
    connectionRef.current = createTaskEventsConnection({
      onEvent: handleEvent,
      onConnect: handleConnect,
      onDisconnect: handleDisconnect,
    });

    return () => {
      connectionRef.current?.close();
    };
  }, [handleEvent, handleConnect, handleDisconnect]);

  const hasWorkingTasks = state.tasks.some((task) => task.status === "WORKING");
  useEffect(() => {
    if (!hasWorkingTasks) return;

    // Task progress is derived from files and can change while status remains WORKING.
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, WORKING_STATUS_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [hasWorkingTasks, refresh]);

  return { ...state, refresh };
};
