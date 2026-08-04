import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import type { Step, StepStatus } from "../types";
import type { SimpleStepKind } from "../workflow/simple-workflow";
import { WorkflowGlyph as Glyph } from "../workflow/workflow-glyphs";
import type { LogLine } from "./LogViewer";

interface StepListProps {
  steps: Step[];
  selectedStepId?: string | null;
  onStepClick?: (stepId: string) => void;
}

export const filterLogsByStep = (logLines: LogLine[], step: Step): LogLine[] => {
  const byStepId = logLines.filter((log) => log.stepExecutionId === step.id);
  if (byStepId.length > 0 || logLines.some((log) => log.stepExecutionId)) {
    return byStepId;
  }

  const startMs = new Date(step.startedAt).getTime();
  const endMs = step.endedAt ? new Date(step.endedAt).getTime() : undefined;

  return logLines.filter((log) => {
    const logMs = new Date(log.timestamp).getTime();
    if (logMs < startMs) return false;
    if (endMs !== undefined && logMs > endMs) return false;
    return true;
  });
};

export const StepList = ({ steps, selectedStepId, onStepClick }: StepListProps) => {
  if (steps.length === 0) {
    return <div className="py-2 px-3 font-sans text-xs text-text-muted">No steps recorded</div>;
  }

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden py-1 px-3"
      data-testid="step-list"
    >
      {steps.map((step, index) => (
        <StepRow
          key={step.id}
          step={step}
          isLast={index === steps.length - 1}
          isSelected={selectedStepId === step.id}
          onStepClick={onStepClick}
        />
      ))}
    </div>
  );
};

interface StepRowProps {
  step: Step;
  isLast: boolean;
  isSelected: boolean;
  onStepClick?: (stepId: string) => void;
}

const StepRow = ({ step, isLast, isSelected, onStepClick }: StepRowProps) => {
  const config = getStepPresentation(step);
  const content = (
    <StepRowContent
      step={step}
      config={config}
      isLast={isLast}
      isSelected={isSelected}
      isClickable={!!onStepClick}
    />
  );

  return (
    <div data-testid={`step-item-${step.id}`}>
      {onStepClick ? (
        <button
          type="button"
          className={`focus-ring flex min-w-0 w-full shrink-0 items-center gap-2 cursor-pointer rounded-control px-1 -mx-1 hover:bg-raised ${isSelected ? "bg-raised" : ""}`}
          onClick={() => onStepClick(step.id)}
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2">{content}</div>
      )}
    </div>
  );
};

interface StepRowContentProps {
  step: Step;
  config: StepPresentation;
  isLast: boolean;
  isSelected: boolean;
  isClickable: boolean;
}

const StepRowContent = ({ step, config, isLast, isSelected, isClickable }: StepRowContentProps) => {
  const errorLabel = step.error ? compactStepError(step.error) : null;

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        <div
          className={`h-1.5 w-1.5 rounded-full ${config.dotColor} ${step.status === "running" ? "animate-pulse" : ""}`}
        />
        {!isLast && <div className="absolute left-[7px] top-[14px] h-4 w-px bg-border" />}
      </div>

      <Glyph
        kind={stepKindFor(step)}
        agent={DEFAULT_AGENT}
        state={stepStateFor(step)}
        size="mini"
      />
      <span className="shrink-0" data-testid="step-type-badge">
        <Badge variant={config.tone} className="font-mono">
          {formatStepLabel(step)}
        </Badge>
      </span>

      <span className={`shrink-0 text-[11.5px] font-medium ${config.textColor}`}>
        {config.label}
      </span>

      <span className="shrink-0 text-[11.5px] text-text-muted">
        {step.status === "running" ? "running..." : formatDuration(step.startedAt, step.endedAt)}
      </span>

      {errorLabel && (
        <span
          className="min-w-0 max-w-[9rem] truncate text-[11.5px] text-blocked"
          title={errorLabel}
        >
          {errorLabel}
        </span>
      )}

      {isClickable ? (
        isSelected ? (
          <ChevronDownIcon
            aria-label="Collapse step"
            className="ml-auto size-3.5 shrink-0 text-text-muted"
            strokeWidth={1.7}
          />
        ) : (
          <ChevronRightIcon
            aria-label="Expand step"
            className="ml-auto size-3.5 shrink-0 text-text-muted"
            strokeWidth={1.7}
          />
        )
      ) : null}
    </>
  );
};

const DEFAULT_AGENT: import("../api/client").WorkflowStepAgent = {
  provider: "claude-code",
  model: "",
  reasoning: "medium",
};

/** Map a task step type onto the composer-rail glyph kinds (PLAN §6.6). */
const stepKindFor = (step: Step): SimpleStepKind => {
  const raw = (step.stepId ?? step.stepType ?? "").toLowerCase();
  if (raw.includes("browser")) return "browser";
  if (raw.includes("test")) return "test";
  if (raw.includes("review")) return "code-review";
  return "implement";
};

const stepStateFor = (step: Step): "idle" | "done" | "active" | "debugging" | "legacy" => {
  if (step.status === "running") return "active";
  if (step.status === "success") return "done";
  if (step.status === "failure") return "debugging";
  return "idle";
};

const formatDuration = (startedAt: string, endedAt?: string): string => {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;

  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const formatStepLabel = (step: Step): string => {
  const raw = step.stepId || step.stepType;
  if (!raw) return "unknown";
  return raw.replace(/-/g, " ").replace(/_/g, " ");
};

const compactStepError = (error: string): string => {
  const compact = error.replace(/\s+/g, " ").trim();
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 117).trimEnd()}...`;
};

interface StepPresentation {
  tone: "working" | "done" | "blocked" | "ready" | "draft" | "secondary";
  textColor: string;
  dotColor: string;
  label: string;
}

const getStepPresentation = (step: Step): StepPresentation => {
  if (isFailureSignal(step.signal)) {
    return { ...TONE_PRESENTATION.blocked, label: formatSignalLabel(step.signal) };
  }

  return statusConfig[step.status];
};

const isFailureSignal = (signal?: string | null): signal is string => {
  if (!signal) return false;
  return signal === "NEEDS_CHANGES" || signal.endsWith("_FAILED") || signal.endsWith("_FAIL");
};

const formatSignalLabel = (signal: string): string => signal.toLowerCase().replace(/_/g, " ");

const TONE_PRESENTATION = {
  working: {
    tone: "working" as const,
    textColor: "text-running",
    dotColor: "bg-running",
  },
  success: {
    tone: "done" as const,
    textColor: "text-ok",
    dotColor: "bg-ok",
  },
  blocked: {
    tone: "blocked" as const,
    textColor: "text-blocked",
    dotColor: "bg-blocked",
  },
  neutral: {
    tone: "secondary" as const,
    textColor: "text-text-subtle",
    dotColor: "bg-text-subtle",
  },
};

const statusConfig: Record<StepStatus, StepPresentation> = {
  running: { ...TONE_PRESENTATION.working, label: "running" },
  success: { ...TONE_PRESENTATION.success, label: "success" },
  failure: { ...TONE_PRESENTATION.blocked, label: "failed" },
  cancelled: { ...TONE_PRESENTATION.neutral, label: "cancelled" },
};
