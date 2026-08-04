import type { RuntimeEvent } from "@aop/common";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type ExecutionUsage, fetchExecutionUsage, fetchRuntimeEvents } from "../api/client";
import { fetchChangeFiles } from "../api/specs-client";
import type { LogLine } from "../components/LogViewer";
import { TaskMetaStrip } from "../components/TaskMetaStrip";
import { useReviewNotes } from "../hooks/useReviewNotes";
import { useSSE } from "../hooks/useSSE";
import type { Execution, Task } from "../types";
import { formatTimestamp } from "../utils/format";
import { TaskDetailDialogs, useDialogs } from "./TaskDetailDialogs";
import { TaskDetailLogsTab } from "./TaskDetailLogsTab";
import { TaskDetailPlanTab } from "./TaskDetailPlanTab";
import { type DetailTab, TaskDetailTabs } from "./TaskDetailTabs";
import { TaskDetailTopBar } from "./TaskDetailTopBar";

interface TaskDetailProps {
  taskId: string;
  tasks: Task[];
  initialFilePath?: string;
  onClose: () => void;
  onNavigate?: (path: string) => void;
}

const formatNoteCount = (count: number): string => `${count} ${count === 1 ? "note" : "notes"}`;

interface LogEvent {
  type: "log" | "replay";
  stream?: "stdout" | "stderr";
  content?: string;
  timestamp?: string;
  stepExecutionId?: string;
  lines?: {
    stream: string;
    content: string;
    timestamp: string;
    stepExecutionId?: string;
  }[];
}

const SPEC_DOC_FILES = new Set(["issues.md", "prd.md", "plan.md"]);

const hasSpecDoc = (files: string[]): boolean => files.some((file) => SPEC_DOC_FILES.has(file));

const useTaskLogs = (activeExecutionId: string | null) => {
  const [logLines, setLogLines] = useState<LogLine[]>([]);

  const handleLogMessage = useCallback((_eventType: string, data: LogEvent) => {
    if (data.type === "log") {
      const { stream, content, timestamp, stepExecutionId } = data;
      if (stream && content && timestamp) {
        setLogLines((prev) => [...prev, { type: stream, content, timestamp, stepExecutionId }]);
      }
    } else if (data.type === "replay" && data.lines) {
      setLogLines(
        data.lines.map((line) => ({
          type: line.stream as "stdout" | "stderr",
          content: line.content,
          timestamp: line.timestamp,
          stepExecutionId: line.stepExecutionId,
        })),
      );
    }
  }, []);

  const { connected } = useSSE<LogEvent>({
    url: activeExecutionId ? `/api/executions/${activeExecutionId}/logs` : null,
    eventTypes: ["message"],
    onMessage: handleLogMessage,
  });

  useLayoutEffect(() => {
    if (activeExecutionId) setLogLines([]);
  }, [activeExecutionId]);

  return { logLines, connected };
};

const useTaskSpecAvailability = (task: Task | undefined) => {
  const taskRepoId = task?.repoId;
  const taskId = task?.id;
  const knownHasSpec = task?.hasPlan === true;
  const [loaded, setLoaded] = useState(false);
  const [hasSpec, setHasSpec] = useState(false);

  useEffect(() => {
    if (!taskRepoId || !taskId) {
      setLoaded(true);
      setHasSpec(false);
      return;
    }

    if (knownHasSpec) {
      setLoaded(true);
      setHasSpec(true);
      return;
    }

    let cancelled = false;
    setLoaded(false);
    setHasSpec(false);

    void fetchChangeFiles(taskRepoId, taskId)
      .then((files) => {
        if (cancelled) return;
        setHasSpec(hasSpecDoc(files));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHasSpec(false);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [knownHasSpec, taskRepoId, taskId]);

  return { loaded, hasSpec };
};

const shouldDefaultToLogs = (
  task: Task | undefined,
  specAvailability: { loaded: boolean; hasSpec: boolean },
): boolean =>
  task?.status === "WORKING" ||
  (task?.status === "DRAFT" &&
    Boolean(task.currentExecutionId) &&
    (!specAvailability.loaded || !specAvailability.hasSpec));

export const TaskDetail = ({
  taskId,
  tasks,
  initialFilePath,
  onClose,
  onNavigate,
}: TaskDetailProps) => {
  const task = tasks.find((t) => t.id === taskId);
  const controller = useTaskDetailController(task, onClose, initialFilePath);

  if (!task) {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <MissingTaskState onBack={() => onNavigate?.("/pool")} />
      </div>
    );
  }

  return (
    <TaskDetailView
      task={task}
      controller={controller}
      initialFilePath={initialFilePath}
      onBack={() => (onNavigate ? onNavigate("/pool") : onClose())}
      onNavigate={onNavigate}
    />
  );
};

type TaskDetailController = ReturnType<typeof useTaskDetailController>;

const useTaskDetailController = (
  task: Task | undefined,
  onClose: () => void,
  initialFilePath?: string,
) => {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEvent[]>([]);
  const [executionUsage, setExecutionUsage] = useState<ExecutionUsage | null>(null);

  const specAvailability = useTaskSpecAvailability(task);
  const specsTabAvailable =
    Boolean(initialFilePath) || !specAvailability.loaded || specAvailability.hasSpec;
  const logsDefaultActive = initialFilePath ? false : shouldDefaultToLogs(task, specAvailability);
  const tabs = useTaskTabs({ task, specAvailability, runtimeEvents, initialFilePath });

  const activeExecutionId = expandedExecutionId ?? task?.currentExecutionId ?? null;
  const { logLines, connected: logsConnected } = useTaskLogs(activeExecutionId ?? null);
  const allSteps = useMemo(() => executions.flatMap((e) => e.steps), [executions]);
  const dialogs = useDialogs(task, onClose);
  const reviewNotes = useReviewNotes(task?.repoId, task?.id);

  const handleSubmitCorrections = useCallback(async () => {
    try {
      const result = await reviewNotes.submitCorrections();
      dialogs.showToast(
        `Correction round submitted: ${formatNoteCount(result.submittedCount)}`,
        "success",
      );
    } catch (err) {
      dialogs.showToast(err instanceof Error ? err.message : "Failed to submit corrections");
    }
  }, [dialogs, reviewNotes]);

  useTaskExecutions(task, setExecutions, setExpandedExecutionId);
  useExecutionEvidence(expandedExecutionId, setRuntimeEvents, setExecutionUsage);

  return {
    executions,
    expandedExecutionId,
    setExpandedExecutionId,
    runtimeEvents,
    executionUsage,
    logLines,
    logsConnected,
    allSteps,
    dialogs,
    reviewNotes,
    specsTabAvailable,
    logsDefaultActive,
    activeTab: tabs.activeTab,
    onTabChange: tabs.onTabChange,
    handleSubmitCorrections,
  };
};

const useTaskTabs = ({
  task,
  specAvailability,
  runtimeEvents,
  initialFilePath,
}: {
  task: Task | undefined;
  specAvailability: { loaded: boolean; hasSpec: boolean };
  runtimeEvents: RuntimeEvent[];
  initialFilePath?: string;
}) => {
  const specsTabAvailable =
    Boolean(initialFilePath) || !specAvailability.loaded || specAvailability.hasSpec;
  const logsDefaultActive = initialFilePath ? false : shouldDefaultToLogs(task, specAvailability);
  const defaultTab = resolveDefaultTaskDetailTab(task, initialFilePath);

  const [activeTab, setActiveTab] = useState<DetailTab>(defaultTab);
  const userSelectedTab = useRef(false);
  const tabContextKey = `${task?.id ?? ""}:${task?.currentExecutionId ?? ""}`;
  const previousTabContextKey = useRef(tabContextKey);

  if (previousTabContextKey.current !== tabContextKey) {
    previousTabContextKey.current = tabContextKey;
    userSelectedTab.current = false;
  }

  const onTabChange = useCallback((tab: DetailTab) => {
    userSelectedTab.current = true;
    setActiveTab(tab);
  }, []);

  useLayoutEffect(() => {
    if (userSelectedTab.current) return;
    setActiveTab(logsDefaultActive ? "logs" : "specs");
  }, [logsDefaultActive]);

  useEffect(() => {
    if (activeTab === "specs" && !specsTabAvailable) setActiveTab("logs");
  }, [activeTab, specsTabAvailable]);

  useEffect(() => {
    if (task?.status !== "DRAFT" || !task.currentExecutionId) return;
    if (!specAvailability.loaded || !specAvailability.hasSpec) return;
    setActiveTab((currentTab) => (currentTab === "logs" ? "specs" : currentTab));
  }, [specAvailability.hasSpec, specAvailability.loaded, task?.currentExecutionId, task?.status]);

  useEffect(() => {
    if (userSelectedTab.current) return;
    if (!runtimeEvents.some((event) => event.kind === "verification_evidence_recorded")) return;
    setActiveTab("logs");
  }, [runtimeEvents]);

  return { activeTab, onTabChange };
};

const resolveDefaultTaskDetailTab = (
  task: Task | undefined,
  initialFilePath: string | undefined,
): DetailTab => {
  if (initialFilePath) return "specs";

  const knownSpecAvailability = {
    loaded: task?.hasPlan === true,
    hasSpec: task?.hasPlan === true,
  };
  return shouldDefaultToLogs(task, knownSpecAvailability) ? "logs" : "specs";
};

const useTaskExecutions = (
  task: Task | undefined,
  setExecutions: (execs: Execution[]) => void,
  setExpandedExecutionId: (id: string) => void,
) => {
  useEffect(() => {
    if (!task) return;
    fetch(`/api/repos/${task.repoId}/tasks/${task.id}/executions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const execs: Execution[] = data.executions ?? [];
        setExecutions(execs);
        const latest = execs[0];
        if (latest) setExpandedExecutionId(latest.id);
      })
      .catch(() => {});
  }, [task, setExecutions, setExpandedExecutionId]);
};

const useExecutionEvidence = (
  expandedExecutionId: string | null,
  setRuntimeEvents: (events: RuntimeEvent[]) => void,
  setExecutionUsage: (usage: ExecutionUsage | null) => void,
) => {
  useEffect(() => {
    if (!expandedExecutionId) {
      setRuntimeEvents([]);
      setExecutionUsage(null);
      return;
    }

    let cancelled = false;
    fetchRuntimeEvents(expandedExecutionId)
      .then((events) => {
        if (!cancelled) setRuntimeEvents(events);
      })
      .catch(() => {
        if (!cancelled) setRuntimeEvents([]);
      });

    fetchExecutionUsage(expandedExecutionId)
      .then((usage) => {
        if (!cancelled) setExecutionUsage(usage);
      })
      .catch(() => {
        if (!cancelled) setExecutionUsage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [expandedExecutionId, setRuntimeEvents, setExecutionUsage]);
};

const TaskDetailView = ({
  task,
  controller,
  initialFilePath,
  onBack,
  onNavigate,
}: {
  task: Task;
  controller: TaskDetailController;
  initialFilePath?: string;
  onBack: () => void;
  onNavigate?: (path: string) => void;
}) => {
  const { dialogs, reviewNotes } = controller;
  const repoName = task.repoPath?.split("/").pop() ?? task.repoPath ?? "Unknown repo";
  const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? task.id;
  return (
    <div
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas"
      data-testid="task-detail"
    >
      <TaskDetailTopBar
        task={task}
        changeName={changeName}
        isMarkingReady={dialogs.isMarkingReady}
        isSubmittingCorrections={reviewNotes.submitting}
        pendingReviewNoteCount={reviewNotes.pendingNoteCount}
        isResetting={dialogs.isResetting}
        onBack={onBack}
        onMarkReady={() => void dialogs.handleMarkReady()}
        onSubmitCorrections={() => void controller.handleSubmitCorrections()}
        onRetry={() => dialogs.setShowRetryDialog(true)}
        onResume={() => dialogs.setShowResumeDialog(true)}
        onReset={() => void dialogs.handleReset()}
        onShowBlockDialog={() => dialogs.setShowBlockDialog(true)}
        onShowRemoveDialog={() => dialogs.setShowRemoveDialog(true)}
      />

      <TaskMetaStrip
        task={task}
        repoName={repoName}
        workflow={task.assignedAgentWorkflow ?? "Unassigned"}
        workflowHref={undefined}
        onWorkflowNavigate={onNavigate}
        assignee={task.assignedAgentName ?? "Unassigned"}
        runtime={formatRuntimeState(task)}
        created={formatTimestamp(task.createdAt)}
      />

      <TaskDetailTabs
        activeTab={controller.activeTab}
        onTabChange={controller.onTabChange}
        isWorking={controller.logsDefaultActive}
        showSpecs={controller.specsTabAvailable}
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TaskDetailTabContent
          task={task}
          controller={controller}
          initialFilePath={initialFilePath}
        />
      </main>

      <TaskDetailDialogs task={task} dialogs={dialogs} steps={controller.allSteps} />
    </div>
  );
};

const TaskDetailTabContent = ({
  task,
  controller,
  initialFilePath,
}: {
  task: Task;
  controller: TaskDetailController;
  initialFilePath?: string;
}) => {
  const { reviewNotes } = controller;

  if (controller.activeTab === "logs") {
    return (
      <TaskDetailLogsTab
        task={task}
        executions={controller.executions}
        expandedExecutionId={controller.expandedExecutionId}
        logLines={controller.logLines}
        logsConnected={controller.logsConnected}
        runtimeEvents={controller.runtimeEvents}
        executionUsage={controller.executionUsage}
        onToggleExecution={(id) => controller.setExpandedExecutionId(id)}
      />
    );
  }

  if (!controller.specsTabAvailable) return null;

  return (
    <TaskDetailPlanTab
      task={task}
      initialFilePath={initialFilePath}
      notes={reviewNotes.notes}
      pendingNoteCount={reviewNotes.pendingNoteCount}
      submitting={reviewNotes.submitting}
      onCreateNote={reviewNotes.createNote}
      onDeleteNote={reviewNotes.deleteNote}
      onUpdateNote={reviewNotes.updateNote}
      onSubmitCorrections={() => void controller.handleSubmitCorrections()}
    />
  );
};

const MissingTaskState = ({ onBack }: { onBack: () => void }) => (
  <main className="flex flex-1 items-center justify-center px-6 py-12">
    <section className="max-w-md rounded-card border border-border bg-surface p-8 text-center shadow-2">
      <span className="text-[12px] font-medium text-text-subtle">Missing task</span>
      <h1 className="mt-3 font-sans text-2xl font-semibold text-text">Task not found</h1>
      <p className="mt-3 font-sans text-sm leading-6 text-text-muted">
        Return to the board or refresh after the next pool sync.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="focus-ring mt-5 cursor-pointer rounded-control border border-border bg-surface px-3 py-1.5 font-sans text-sm font-medium text-text transition hover:border-border-strong"
      >
        Back to Pool
      </button>
    </section>
  </main>
);

const formatRuntimeState = (task: Task): string => {
  if (!task.currentExecutionId) return "No session";
  if (task.status === "WORKING") return "running";
  if (task.status === "DONE") return "completed";
  if (task.runtimeActivity?.sessionState) return task.runtimeActivity.sessionState;
  if (task.status === "BLOCKED") return "blocked";
  if (task.status === "PAUSED") return "paused";
  return "has execution";
};
