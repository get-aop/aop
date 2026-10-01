import type { Project, RuntimePreference } from "@aop/common";
import { ChevronDownIcon } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { patchProject } from "../../api/projects";
import { useRuntimeConfiguration } from "../../hooks/runtime-configuration";
import { useLiveProjects } from "../ProjectsProvider";
import {
  defaultEffortLabel,
  defaultModelLabel,
  effortLabel,
  effortOptions,
  modelLabel,
  modelOptions,
} from "./runtime-options";

const DEFAULT_VALUE = "default";

const CHIP_CLASS =
  "flex h-8 min-w-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-meta font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text disabled:opacity-50";

/**
 * The model and effort the project's coordinator runs on, in the composer's footer as in the
 * apps this one follows. They are the project's own settings: a change here is saved to the
 * project and applies from the coordinator's next turn.
 */
export const CoordinatorChips = ({ project }: { project: Project }) => {
  const live = useLiveProjects();
  const { providers } = useRuntimeConfiguration();
  const preference = project.coordinator;
  const reported = project.reportedRuntime.coordinator;
  const options = useMemo(
    () => modelOptions(preference.provider, providers),
    [preference.provider, providers],
  );
  const efforts = useMemo(() => effortOptions(preference, options), [preference, options]);
  const editable = project.status !== "archived";

  const change = async (next: RuntimePreference) => {
    try {
      live.adopt(await patchProject(project.id, { coordinator: next }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the coordinator");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="coordinator-model"
            aria-label="Coordinator model"
            disabled={!editable}
            className={cn(CHIP_CLASS, "max-w-48")}
          >
            <span className="truncate">{modelLabel(preference, options, reported)}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" data-testid="coordinator-model-menu">
          <DropdownMenuLabel>Coordinator model</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference.model ?? DEFAULT_VALUE}
            onValueChange={(value) =>
              void change({ ...preference, model: value === DEFAULT_VALUE ? null : value })
            }
          >
            <DropdownMenuRadioItem value={DEFAULT_VALUE} data-testid="coordinator-model-default">
              {defaultModelLabel(reported, options)}
            </DropdownMenuRadioItem>
            {options.map(({ model, label }) => (
              <DropdownMenuRadioItem
                key={model}
                value={model}
                data-testid={`coordinator-model-${model}`}
              >
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="coordinator-effort"
            aria-label="Coordinator effort"
            disabled={!editable}
            className={CHIP_CLASS}
          >
            <span>{effortLabel(preference, reported)}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" data-testid="coordinator-effort-menu">
          <DropdownMenuLabel>Coordinator effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference.effort ?? DEFAULT_VALUE}
            onValueChange={(value) =>
              void change({
                ...preference,
                effort: efforts.find((option) => option.value === value)?.value ?? null,
              })
            }
          >
            <DropdownMenuRadioItem value={DEFAULT_VALUE} data-testid="coordinator-effort-default">
              {defaultEffortLabel(preference.provider, reported)}
            </DropdownMenuRadioItem>
            {efforts.map(({ value, label }) => (
              <DropdownMenuRadioItem
                key={value}
                value={value}
                data-testid={`coordinator-effort-${value}`}
              >
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
