import type { Project, ReportedRuntime } from "@aop/common";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { useRuntimeConfiguration } from "../../hooks/runtime-configuration";
import {
  changeModel,
  changeRuntime,
  defaultEffortLabel,
  defaultModelLabel,
  effortOptions,
  type ModelOption,
  modelOptions,
} from "../chat/runtime-options";
import { RuntimeNotReady, RuntimeSelect } from "../RuntimeSelect";
import { ROW_SELECT_CLASS, SettingRow, SettingsGroup } from "./blocks";
import { type AutosaveSettings, useSettingsAutosave } from "./use-settings-autosave";

// A Radix select item cannot have an empty value, and null ("use default": no flag is passed) needs one.
const USE_DEFAULT = "default";

type Kind = "coordinator" | "thread";
type Row = "runtime" | "model" | "effort";

const ROLES: Record<
  Kind,
  { title: string; group: string; runtime: string; model: string; effort: string }
> = {
  coordinator: {
    title: "Coordinator",
    group: "Coordinator",
    runtime: "The command the coordinator runs on. A change applies from its next turn.",
    model: "Model for reading every message and deciding what to do.",
    effort: "It rarely needs much thinking, so a low effort keeps it quick.",
  },
  thread: {
    title: "Thread",
    group: "Threads",
    runtime:
      "The command new threads run on. A thread keeps the runtime it started on for its whole life.",
    model: "Model for new threads. A new thread starts on these and keeps them for its whole life.",
    effort: "Effort for new threads. A change here applies to the threads you start next.",
  },
};

/**
 * Runtime, model and effort for the coordinator and for the threads, a group each. The model and
 * effort lists are the chosen runtime's, from the same source as the coordinator's chips. The
 * "use default" choice reads "Default (Opus 5.5)" once a run of the role reported what the CLI
 * picked, and plain "Default" before one has. Each choice saves as it is made.
 */
export const ModelsSection = ({ project }: { project: Project }) => {
  const settings = useSettingsAutosave(project);
  const reported = project.reportedRuntime;
  return (
    <div data-testid="settings-models" className="flex flex-col gap-6">
      <RolePickers
        kind="coordinator"
        project={project}
        settings={settings}
        reported={reported.coordinator}
      />
      <RolePickers kind="thread" project={project} settings={settings} reported={reported.thread} />
    </div>
  );
};

const RolePickers = ({
  kind,
  project,
  settings,
  reported,
}: {
  kind: Kind;
  project: Project;
  settings: AutosaveSettings;
  reported: ReportedRuntime;
}) => {
  const role = ROLES[kind];
  const { providers } = useRuntimeConfiguration();
  // What the person chose, else what the project runs on; a stored role always names its runtime.
  const preference = settings.value(kind);
  const current = { ...preference, runtimeId: preference.runtimeId ?? project[kind].runtimeId };
  const { runtimeId } = current;
  const options = modelOptions(runtimeId, providers);
  const efforts = effortOptions(current, options);
  // Runtime, model and effort are one setting; the row the person last changed says when it is saved.
  const [changed, setChanged] = useState<Row>("model");
  const status = settings.state(kind);

  return (
    <SettingsGroup testId={`settings-${kind}-runtime`} title={role.group}>
      <SettingRow
        label="Runtime"
        description={role.runtime}
        htmlFor={`settings-${kind}-runtime-select`}
        status={changed === "runtime" ? status : undefined}
        below={
          <RuntimeNotReady runtimeId={runtimeId} testId={`settings-${kind}-runtime-not-ready`} />
        }
        control={
          <RuntimeSelect
            id={`settings-${kind}-runtime-select`}
            testId={`settings-${kind}-runtime-select`}
            label={`${role.title} runtime`}
            className={ROW_SELECT_CLASS}
            value={runtimeId}
            onChange={(next) => {
              setChanged("runtime");
              settings.set(kind, changeRuntime(current, next, providers));
            }}
          />
        }
      />
      <SettingRow
        label="Model"
        description={role.model}
        htmlFor={`settings-${kind}-model`}
        status={changed === "model" ? status : undefined}
        control={
          <Select
            value={current.model ?? USE_DEFAULT}
            onValueChange={(model) => {
              setChanged("model");
              settings.set(
                kind,
                changeModel(current, model === USE_DEFAULT ? null : model, options),
              );
            }}
          >
            <SelectTrigger
              id={`settings-${kind}-model`}
              aria-label={`${role.title} model`}
              data-testid={`settings-${kind}-model`}
              className={ROW_SELECT_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={USE_DEFAULT}>{defaultModelLabel(reported, options)}</SelectItem>
              {withCurrent(options, current.model).map((option) => (
                <SelectItem key={option.model} value={option.model}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <SettingRow
        label="Effort"
        description={role.effort}
        htmlFor={`settings-${kind}-effort`}
        status={changed === "effort" ? status : undefined}
        control={
          <Select
            value={current.effort ?? USE_DEFAULT}
            onValueChange={(effort) => {
              setChanged("effort");
              settings.set(kind, {
                ...current,
                effort: efforts.find((option) => option.value === effort)?.value ?? null,
              });
            }}
          >
            <SelectTrigger
              id={`settings-${kind}-effort`}
              aria-label={`${role.title} effort`}
              data-testid={`settings-${kind}-effort`}
              className={ROW_SELECT_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={USE_DEFAULT}>
                {defaultEffortLabel(current.provider, reported)}
              </SelectItem>
              {efforts.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroup>
  );
};

// A model the runtime does not list (set by hand or by another tool) stays selectable, so
// opening the settings never shows something the project is not using.
const withCurrent = (
  options: readonly ModelOption[],
  model: string | null,
): readonly ModelOption[] =>
  model && !options.some((option) => option.model === model)
    ? [{ model, label: model, efforts: [], isDefault: false }, ...options]
    : options;
