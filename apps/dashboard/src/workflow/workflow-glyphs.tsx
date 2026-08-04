import {
  BugIcon,
  CheckIcon,
  FlaskConicalIcon,
  GlobeIcon,
  HammerIcon,
  SearchCodeIcon,
  ZapIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { Badge } from "@/ui/badge";
import { Chip } from "@/ui/chip";
import { RuntimeProviderIcon } from "@/ui/provider-icon";
import type { WorkflowStepAgent, WorkflowSummary } from "../api/client";
import { decompileSimpleWorkflow, type SimpleStepKind } from "./simple-workflow";

export const STEP_KIND_ICONS = {
  implement: HammerIcon,
  "code-review": SearchCodeIcon,
  test: FlaskConicalIcon,
  browser: GlobeIcon,
} as const;

export const STEP_KIND_LABELS: Record<SimpleStepKind, string> = {
  implement: "Implement",
  "code-review": "Code review",
  test: "Test",
  browser: "Browser check",
};

/**
 * THE workflow step renderer (PLAN §6.4): step icon + provider mark + model
 * short label + effort, in `mini` (icon pair) and `full` sizes. States:
 * done / active / debugging / legacy.
 */
export const WorkflowGlyph = ({
  kind,
  agent,
  state = "idle",
  size = "full",
  retries,
  retryLimit,
}: {
  kind: SimpleStepKind;
  agent: WorkflowStepAgent;
  state?: "idle" | "done" | "active" | "debugging" | "legacy";
  size?: "mini" | "full";
  retries?: number;
  retryLimit?: number;
}) => {
  if (size === "mini") {
    return <MiniGlyph kind={kind} agent={agent} state={state} />;
  }

  return (
    <FullGlyph kind={kind} agent={agent} state={state} retries={retries} retryLimit={retryLimit} />
  );
};

const MiniGlyph = ({
  kind,
  agent,
  state,
}: {
  kind: SimpleStepKind;
  agent: WorkflowStepAgent;
  state: "idle" | "done" | "active" | "debugging" | "legacy";
}) => {
  const Icon = STEP_KIND_ICONS[kind];
  return (
    <span
      data-testid="workflow-glyph"
      data-size="mini"
      data-state={state}
      title={`${STEP_KIND_LABELS[kind]} · ${agent.provider} ${modelShortLabel(agent.model)}`}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-raised px-1.5 text-[11px] text-text-muted",
        state === "done" && "text-text-subtle",
      )}
    >
      <Icon className="size-3" strokeWidth={1.7} />
      <RuntimeProviderIcon runtime={agent.provider} className="size-3" />
    </span>
  );
};

const FullGlyph = ({
  kind,
  agent,
  state,
  retries,
  retryLimit,
}: {
  kind: SimpleStepKind;
  agent: WorkflowStepAgent;
  state: "idle" | "done" | "active" | "debugging" | "legacy";
  retries?: number;
  retryLimit?: number;
}) => {
  const Icon = STEP_KIND_ICONS[kind];
  return (
    <span
      data-testid="workflow-glyph"
      data-size="full"
      data-state={state}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-raised px-2.5 text-[12px] text-text",
        state === "done" && "text-text-subtle",
        state === "active" && "border-border-bold",
        state === "legacy" && "text-text-muted",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.7} />
      <RuntimeProviderIcon runtime={agent.provider} className="size-3.5 shrink-0" />
      <span className="max-w-28 truncate">{modelShortLabel(agent.model)}</span>
      <span className="text-[11px] text-text-subtle">{agent.reasoning}</span>
      {agent.fastMode ? <ZapIcon className="size-3 text-favorite" /> : null}
      {state === "done" ? <CheckIcon className="size-3 shrink-0 text-ok" /> : null}
      {state === "active" ? (
        <span className="aop-running-dot size-1.5 rounded-full bg-running motion-safe:animate-[aop-pulse_2s_ease-in-out_infinite]" />
      ) : null}
      {state === "debugging" ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-favorite">
          <BugIcon className="size-3" />
          retry {retries ?? 0}/{retryLimit ?? 2}
        </span>
      ) : null}
    </span>
  );
};

const modelShortLabel = (model: string): string => {
  const match = model.match(/^(?:claude-)?([a-z0-9.-]+)/i);
  return match?.[1] ?? model;
};

/** Legacy single-chip: “N steps · runs as-is”. */
export const LegacyWorkflowGlyph = ({ stepCount }: { stepCount: number }) => (
  <Badge variant="tag" data-testid="workflow-glyph" data-size="legacy">
    {stepCount} steps · runs as-is
  </Badge>
);

/** Full glyph sequence for a workflow summary (Legacy when not simple). */
export const WorkflowGlyphSequence = ({ workflow }: { workflow: WorkflowSummary }) => {
  const simple = decompileSimpleWorkflow(workflow);
  if (!simple) {
    return <LegacyWorkflowGlyph stepCount={workflow.stepCount} />;
  }
  return (
    <span className="flex min-w-0 items-center gap-1" data-testid="workflow-glyph-sequence">
      {simple.steps.map((step) => (
        <WorkflowGlyph key={step.kind} kind={step.kind} agent={step.agent} size="mini" />
      ))}
    </span>
  );
};

/** A step row as seen in workflow selections/catalog options (id/type/provider/model/reasoning/fastMode). */
export interface WorkflowSelectionStep {
  id: string;
  type: string;
  provider?: string;
  model?: string;
  reasoning?: string;
  fastMode?: boolean;
}

export const kindForStepType = (type: string): SimpleStepKind => {
  if (type === "review") return "code-review";
  if (type === "test") return "test";
  if (type === "browser" || type.includes("browser")) return "browser";
  return "implement";
};

const agentFromStep = (step: WorkflowSelectionStep): WorkflowStepAgent => ({
  provider: (step.provider as WorkflowStepAgent["provider"]) ?? "pi",
  model: step.model ?? "",
  reasoning: (step.reasoning as WorkflowStepAgent["reasoning"]) ?? "medium",
  fastMode: step.fastMode,
});

/** THE step-sequence renderer for selection previews, the composer rail, and pickers. */
export const WorkflowStepsGlyphs = ({
  steps,
  stepCount,
  size = "mini",
  className,
}: {
  steps: WorkflowSelectionStep[] | undefined;
  stepCount: number;
  /** "mini" = icon pair (pickers); "chip" = full step chip (composer rail, §6.4). */
  size?: "mini" | "chip";
  className?: string;
}) => {
  if (!steps || steps.length === 0) {
    return <LegacyWorkflowGlyph stepCount={stepCount} />;
  }
  if (size === "chip") {
    return (
      <span
        className={cn("flex min-w-0 items-center gap-1", className)}
        data-testid="workflow-step-glyphs"
      >
        {steps.map((step) => {
          const agent = agentFromStep(step);
          const Icon = STEP_KIND_ICONS[kindForStepType(step.type)];
          return (
            <Chip
              key={step.id}
              variant="step"
              data-testid="workflow-step-chip"
              disabled
              title={`${STEP_KIND_LABELS[kindForStepType(step.type)]} · ${agent.provider} ${agent.model}`}
            >
              <Icon className="size-3.5" strokeWidth={1.7} />
              <RuntimeProviderIcon runtime={agent.provider} className="size-3.5" />
              <span className="max-w-24 truncate">{modelShortLabel(agent.model)}</span>
              <span className="text-[11px] text-text-subtle">{agent.reasoning}</span>
              {agent.fastMode ? <ZapIcon className="size-3 text-favorite" /> : null}
            </Chip>
          );
        })}
      </span>
    );
  }
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1", className)}
      data-testid="workflow-step-glyphs"
    >
      {steps.map((step) => (
        <WorkflowGlyph
          key={step.id}
          kind={kindForStepType(step.type)}
          agent={agentFromStep(step)}
          size="mini"
        />
      ))}
    </span>
  );
};
