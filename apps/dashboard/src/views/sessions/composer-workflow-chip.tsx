import {
  CheckIcon,
  FlameIcon,
  FlaskConicalIcon,
  HammerIcon,
  RouteIcon,
  SearchCodeIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { Badge } from "@/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { openSettingsDialog } from "../../shell/dialog-store";
import type { WorkflowTypeaheadOption } from "./typeahead";

interface ComposerWorkflowChipProps {
  workflows?: Array<string | WorkflowTypeaheadOption>;
  defaultWorkflowId: string | null;
  onChange: (workflowId: string | null) => void;
}

const workflowEntries = (
  workflows: Array<string | WorkflowTypeaheadOption> | undefined,
): WorkflowTypeaheadOption[] =>
  (workflows ?? []).map((entry) =>
    typeof entry === "string" ? { id: entry, name: entry, stepCount: 0 } : entry,
  );

/**
 * Composer workflow chip (PLAN §6.4): ghost chip → Command picker with
 * mini glyph previews; “New workflow…” deep-links Settings§Workflows.
 */
export const ComposerWorkflowChip = ({
  workflows,
  defaultWorkflowId,
  onChange,
}: ComposerWorkflowChipProps) => {
  const [open, setOpen] = useState(false);
  const entries = workflowEntries(workflows);
  const selected = entries.find((entry) => entry.id === defaultWorkflowId) ?? null;

  const pick = (workflowId: string) => {
    onChange(workflowId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          data-testid="composer-workflow-chip"
          data-on={selected ? "" : undefined}
          className={cn(
            "flex h-7 shrink-0 items-center rounded-lg text-[12.5px] font-medium transition-colors duration-[120ms]",
            selected ? "bg-active text-text" : "text-text-muted",
          )}
        >
          <button
            type="button"
            aria-label="Workflow"
            className="flex h-full min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-inherit outline-none transition-colors duration-[120ms] hover:bg-hover focus-visible:outline-2 focus-visible:outline-running focus-visible:outline-offset-[-2px]"
          >
            <RouteIcon className="size-3.5 shrink-0" strokeWidth={1.7} />
            <span className="max-w-40 truncate">{selected?.name ?? "Workflow"}</span>
          </button>
          {selected ? (
            <button
              type="button"
              data-testid="composer-workflow-clear"
              aria-label="Clear workflow"
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
              }}
              className="mr-0.5 grid size-6 shrink-0 place-items-center rounded-md text-text-subtle outline-none transition-colors duration-[120ms] hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-running"
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 p-0">
        <Command>
          <CommandList>
            <CommandEmpty>No workflows</CommandEmpty>
            <CommandGroup>
              {entries.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={entry.name}
                  onSelect={() => pick(entry.id)}
                  className="gap-2"
                >
                  <RouteIcon className="size-3.5 shrink-0 text-text-subtle" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{entry.name}</span>
                  <WorkflowOptionPreview option={entry} />
                  {entry.id === defaultWorkflowId ? (
                    <CheckIcon className="size-3.5 shrink-0 text-running" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup>
              <CommandItem
                value="__new__"
                onSelect={() => {
                  setOpen(false);
                  openSettingsDialog("workflows");
                }}
                className="gap-2"
              >
                <span className="text-[12.5px] text-running">New workflow…</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/** Mini glyph preview: step icons for simple workflows, “N steps · runs as-is” otherwise. */
const WorkflowOptionPreview = ({ option }: { option: WorkflowTypeaheadOption }) => {
  const steps = option.steps;
  if (!steps || steps.length === 0) {
    return (
      <Badge variant="tag" className="shrink-0">
        {option.stepCount} steps · runs as-is
      </Badge>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {steps.slice(0, 4).map((step) => (
        <StepIcon key={step.id} type={step.type} />
      ))}
      {steps.length > 4 ? (
        <span className="text-[10px] text-text-subtle">+{steps.length - 4}</span>
      ) : null}
    </span>
  );
};

const StepIcon = ({ type }: { type: string }) => {
  const Icon = type === "review" ? SearchCodeIcon : type === "test" ? FlaskConicalIcon : HammerIcon;
  return <Icon className="size-3 text-text-subtle" />;
};

/** Rail above the textarea: workflow name + step icons + fire arm + clear. */
export const ComposerWorkflowRail = ({
  workflows,
  defaultWorkflowId,
  onChange,
  armed = false,
  running = false,
  onArmedChange,
}: ComposerWorkflowChipProps & {
  armed?: boolean;
  running?: boolean;
  onArmedChange?: (armed: boolean) => void;
}) => {
  const entry = workflowEntries(workflows).find((item) => item.id === defaultWorkflowId);
  if (!entry) return null;
  return (
    <div
      data-testid="composer-workflow-rail"
      className="mb-2 flex items-center gap-1.5 rounded-row border border-border bg-raised px-2 py-1"
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-text">
        <RouteIcon className="size-3 shrink-0 text-text-subtle" strokeWidth={1.7} />
        <span className="truncate font-medium">{entry.name}</span>
      </span>
      <WorkflowOptionPreview option={entry} />
      <button
        type="button"
        data-testid="composer-workflow-arm"
        data-armed={armed ? "" : undefined}
        aria-label={
          running
            ? "Workflow running"
            : armed
              ? "Disarm workflow"
              : "Run the next message through this workflow"
        }
        aria-pressed={armed}
        disabled={running}
        onClick={() => onArmedChange?.(!armed)}
        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-90"
      >
        <FlameIcon className={`size-3.5 ${armed ? "aop-flame-armed" : ""}`} />
      </button>
      <button
        type="button"
        data-testid="composer-workflow-rail-clear"
        aria-label="Remove workflow"
        onClick={() => onChange(null)}
        className="grid size-5 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
};
