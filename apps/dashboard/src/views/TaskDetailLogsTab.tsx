import type { RuntimeEvent } from "@aop/common";
import { useEffect, useMemo, useState } from "react";
import type { ExecutionUsage } from "../api/client";
import type { LogLine } from "../components/LogViewer";
import { filterLogsByStep } from "../components/StepList";
import type { Execution, Step, Task } from "../types";
import { EmptyRunPanel, LogPanel } from "./TaskDetailLogsTabEvidence";
import { ExecutionHistory } from "./TaskDetailLogsTabPanels";

const findRunningStepId = (steps: Step[]): string | null =>
  steps.find((s) => s.status === "running")?.id ?? null;

/**
 * Logs & runs tab (PLAN §6.6): Execution history sidebar + evidence panel with
 * the active run's spend, proof, and streamed log lines.
 */
export const TaskDetailLogsTab = ({
  task,
  executions,
  expandedExecutionId,
  logLines,
  logsConnected,
  runtimeEvents = [],
  executionUsage,
  onToggleExecution,
}: {
  task: Task;
  executions: Execution[];
  expandedExecutionId: string | null;
  logLines: LogLine[];
  logsConnected: boolean;
  runtimeEvents?: RuntimeEvent[];
  executionUsage: ExecutionUsage | null;
  onToggleExecution: (id: string) => void;
}) => {
  const isLive =
    task.status === "WORKING" &&
    (!expandedExecutionId || expandedExecutionId === task.currentExecutionId);

  const { selectedStepId, expandedExecution, isStreamingLive, handleStepClick } = useStepSelection(
    executions,
    expandedExecutionId,
    isLive,
  );

  const displayedLogs = useMemo(
    () => getDisplayedLogs(logLines, selectedStepId, expandedExecution),
    [logLines, selectedStepId, expandedExecution],
  );

  return (
    <div
      data-testid="task-logs-tab"
      style={{ flex: 1, display: "flex", minHeight: 0, padding: "20px 24px", gap: "16px" }}
    >
      <ExecutionHistory
        executions={executions}
        expandedExecutionId={expandedExecutionId}
        selectedStepId={selectedStepId}
        onToggleExecution={onToggleExecution}
        onStepClick={handleStepClick}
      />

      {isLive || expandedExecutionId ? (
        <LogPanel
          isStreamingLive={isStreamingLive}
          hasStepSelected={!!selectedStepId}
          logsConnected={logsConnected}
          displayedLogs={displayedLogs}
          runtimeEvents={runtimeEvents}
          executionUsage={executionUsage}
        />
      ) : (
        <EmptyRunPanel />
      )}
    </div>
  );
};

const useStepSelection = (
  executions: Execution[],
  expandedExecutionId: string | null,
  isLive: boolean,
) => {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [prevExpandedId, setPrevExpandedId] = useState<string | null>(null);

  const expandedExecution = useMemo(
    () => executions.find((e) => e.id === expandedExecutionId),
    [executions, expandedExecutionId],
  );

  if (expandedExecutionId !== prevExpandedId) {
    setPrevExpandedId(expandedExecutionId);
    const running = expandedExecution ? findRunningStepId(expandedExecution.steps) : null;
    setSelectedStepId(running);
  }

  const runningStepId = expandedExecution ? findRunningStepId(expandedExecution.steps) : null;
  useEffect(() => {
    if (runningStepId) setSelectedStepId(runningStepId);
  }, [runningStepId]);

  const handleStepClick = (stepId: string) => {
    setSelectedStepId((prev) => (prev === stepId ? null : stepId));
  };

  const isStreamingLive = isLive && (!selectedStepId || selectedStepId === runningStepId);

  return { selectedStepId, expandedExecution, isStreamingLive, handleStepClick };
};

const getDisplayedLogs = (
  logLines: LogLine[],
  selectedStepId: string | null,
  expandedExecution: Execution | undefined,
): LogLine[] => {
  if (!selectedStepId) return logLines;
  const step = expandedExecution?.steps.find((s) => s.id === selectedStepId);
  if (!step) return logLines;
  return filterLogsByStep(logLines, step);
};
