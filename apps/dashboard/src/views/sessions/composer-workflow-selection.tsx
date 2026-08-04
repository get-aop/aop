import type { ChatWorkflowSelection } from "@aop/common";
import { RouteIcon, XIcon, ZapIcon } from "lucide-react";

import { Chip } from "@/ui/chip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { RuntimeProviderIcon } from "@/ui/provider-icon";
import {
  kindForStepType,
  STEP_KIND_ICONS,
  STEP_KIND_LABELS,
  WorkflowStepsGlyphs,
} from "../../workflow/workflow-glyphs";

/**
 * The §6.4 composer rail for a selected #workflow: workflow name at the left
 * (Route icon), full step glyphs, × clears the selection. Legacy selections
 * (no step detail) render a single “N steps · Legacy” chip. Neutral grays
 * only — the amber pill and the Studio link are gone.
 */
export const ComposerWorkflowSelection = ({
  selection,
  onRemove,
}: {
  selection: ChatWorkflowSelection;
  onRemove: () => void;
}) => {
  const steps = selection.steps;
  const isLegacy = !steps || steps.length === 0;

  return (
    <div
      data-testid="composer-workflow-selection"
      className="mb-2 flex items-center gap-2 rounded-row border border-border bg-raised px-2 py-1"
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-text">
        <RouteIcon className="size-3 shrink-0 text-text-subtle" strokeWidth={1.7} />
        <span className="truncate font-medium">{selection.name}</span>
      </span>
      {isLegacy ? (
        <Chip variant="step" data-state="legacy" data-testid="composer-workflow-legacy" disabled>
          {selection.stepCount} steps · Legacy
        </Chip>
      ) : (
        <WorkflowDetailHover steps={steps} name={selection.name}>
          <WorkflowStepsGlyphs steps={steps} stepCount={selection.stepCount} size="chip" />
        </WorkflowDetailHover>
      )}
      <button
        type="button"
        data-testid="composer-workflow-selection-remove"
        aria-label={`Remove workflow ${selection.name}`}
        onClick={onRemove}
        className="grid size-5 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
};

/** Hover detail for the step chips: full provider · model · effort · fast + the auto-debug note. */
const WorkflowDetailHover = ({
  steps,
  name,
  children,
}: {
  steps: NonNullable<ChatWorkflowSelection["steps"]>;
  name: string;
  children: React.ReactNode;
}) => (
  <HoverCard openDelay={150} closeDelay={80}>
    <HoverCardTrigger asChild>
      <span data-testid="composer-workflow-hover-trigger" className="contents">
        {children}
      </span>
    </HoverCardTrigger>
    <HoverCardContent data-testid="composer-workflow-hover" className="w-80" sideOffset={6}>
      <p className="mb-2 truncate text-[12.5px] font-medium text-text">{name}</p>
      <ul className="flex flex-col gap-1.5">
        {steps.map((step) => {
          const kind = kindForStepType(step.type);
          const Icon = STEP_KIND_ICONS[kind];
          const provider = step.provider ?? "pi";
          return (
            <li key={step.id} className="flex items-center gap-2 text-[12px] text-text">
              <Icon className="size-3.5 shrink-0 text-text-subtle" strokeWidth={1.7} />
              <span className="min-w-0 flex-1 truncate font-medium">{STEP_KIND_LABELS[kind]}</span>
              <RuntimeProviderIcon runtime={provider} className="size-3.5 shrink-0" />
              <span className="max-w-36 truncate font-mono text-[11.5px] text-text-subtle">
                {step.model || "default model"}
              </span>
              {step.fastMode ? <ZapIcon className="size-3 shrink-0 text-text-subtle" /> : null}
              <span className="shrink-0 text-text-subtle">{step.reasoning ?? "medium"}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 border-t border-border pt-2 text-[11px] text-text-muted">
        Failed steps retry via a generated --debug / --fix helper (≤2 iterations; tests ≤5).
      </p>
    </HoverCardContent>
  </HoverCard>
);
