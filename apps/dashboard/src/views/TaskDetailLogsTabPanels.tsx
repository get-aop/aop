import { useEffect, useMemo, useRef, useState } from "react";
import { StepList } from "../components/StepList";
import type { Execution } from "../types";
import { formatDuration, formatTimestamp } from "../utils/format";

const PANEL_STYLE: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "14px",
  overflow: "hidden",
};

interface ExecutionHistoryProps {
  executions: Execution[];
  expandedExecutionId: string | null;
  selectedStepId: string | null;
  onToggleExecution: (id: string) => void;
  onStepClick: (stepId: string) => void;
}

export const ExecutionHistory = ({
  executions,
  expandedExecutionId,
  selectedStepId,
  onToggleExecution,
  onStepClick,
}: ExecutionHistoryProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const ascending = useMemo(() => [...executions].reverse(), [executions]);
  const hasRunningExecution = useMemo(
    () => executions.some((execution) => execution.status === "running" && !execution.finishedAt),
    [executions],
  );

  useEffect(() => {
    if (!hasRunningExecution) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [hasRunningExecution]);

  useEffect(() => {
    if (ascending.length === 0) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ascending]);

  useEffect(() => {
    if (!expandedExecutionId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(
      `[data-testid="execution-item-${expandedExecutionId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [expandedExecutionId]);

  return (
    <aside
      data-testid="execution-history"
      style={{
        width: "300px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        ...PANEL_STYLE,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600 }}>
          Execution history
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--color-text-subtle)",
            background: "color-mix(in srgb,var(--color-text-subtle) 12%,transparent)",
            borderRadius: "6px",
            padding: "2px 8px",
          }}
        >
          {formatRunCount(executions.length)}
        </span>
      </div>

      {executions.length === 0 ? (
        <p
          style={{
            padding: "24px 8px",
            textAlign: "center",
            fontFamily: "var(--font-sans)",
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--color-text-subtle)",
          }}
        >
          No executions yet. Continue the task to start the first run.
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="aop-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "9px",
          }}
        >
          {ascending.map((execution) => (
            <ExecutionPill
              key={execution.id}
              execution={execution}
              isExpanded={expandedExecutionId === execution.id}
              selectedStepId={selectedStepId}
              onToggle={() => onToggleExecution(execution.id)}
              onStepClick={onStepClick}
            />
          ))}
        </div>
      )}
    </aside>
  );
};

const ExecutionPill = ({
  execution,
  isExpanded,
  selectedStepId,
  onToggle,
  onStepClick,
}: {
  execution: Execution;
  isExpanded: boolean;
  selectedStepId: string | null;
  onToggle: () => void;
  onStepClick: (stepId: string) => void;
}) => (
  <div data-testid={`execution-item-${execution.id}`}>
    <button
      type="button"
      onClick={onToggle}
      className="focus-ring"
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        background: isExpanded ? "var(--color-raised)" : "var(--color-surface)",
        border: `1px solid ${isExpanded ? "var(--color-border-strong)" : "var(--color-border)"}`,
        borderRadius: "11px",
        padding: "11px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: STATUS_DOT[execution.status],
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12.5,
            fontWeight: 600,
            color: STATUS_COLOR[execution.status],
          }}
        >
          {STATUS_LABEL[execution.status]}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 500,
            color: "var(--color-text-subtle)",
          }}
        >
          {formatDuration(execution.startedAt, execution.finishedAt)}
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-text-subtle)",
          marginTop: "5px",
        }}
      >
        <span>{formatStepCount(execution.steps.length)}</span>
        <span> · {formatTimestamp(execution.startedAt)}</span>
      </div>
    </button>

    {isExpanded && execution.steps.length > 0 ? (
      <div
        style={{
          marginTop: "8px",
          borderLeft: "1px solid var(--color-border)",
          paddingLeft: "12px",
        }}
      >
        <StepList
          steps={execution.steps}
          selectedStepId={selectedStepId}
          onStepClick={onStepClick}
        />
      </div>
    ) : null}
  </div>
);

const STATUS_LABEL: Record<Execution["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_COLOR: Record<Execution["status"], string> = {
  running: "var(--color-running)",
  completed: "var(--color-ok)",
  failed: "var(--color-blocked)",
};

const STATUS_DOT: Record<Execution["status"], string> = {
  running: "var(--color-running)",
  completed: "var(--color-ok)",
  failed: "var(--color-blocked)",
};

const formatRunCount = (count: number): string => `${count} ${count === 1 ? "run" : "runs"}`;
const formatStepCount = (count: number): string => `${count} ${count === 1 ? "step" : "steps"}`;
