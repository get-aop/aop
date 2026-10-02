import {
  formatRuntimeModelLabel,
  getDefaultRuntimeModel,
  getRuntimeModelOptions,
  getThinkingOptions,
  type Project,
  type ReportedRuntime,
  type RuntimePreference,
} from "@aop/common";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { defaultEffortLabel, defaultModelLabel } from "../chat/runtime-options";
import { ROW_SELECT_CLASS, SettingRow, SettingsGroup } from "./blocks";
import { type AutosaveSettings, useSettingsAutosave } from "./use-settings-autosave";

// A Radix select item cannot have an empty value, and null ("use default": no flag is passed) needs one.
const USE_DEFAULT = "default";

type Kind = "coordinator" | "thread";

const ROLES: Record<Kind, { title: string; group: string; model: string; effort: string }> = {
  coordinator: {
    title: "Coordinator",
    group: "Coordinator",
    model: "Model for reading every message and deciding what to do.",
    effort: "It rarely needs much thinking, so a low effort keeps it quick.",
  },
  thread: {
    title: "Thread",
    group: "Threads",
    model: "Model for new threads. A new thread starts on these and keeps them for its whole life.",
    effort: "Effort for new threads. A change here applies to the threads you start next.",
  },
};

/**
 * Model and effort for the coordinator and for the threads, a group each. The "use default"
 * choice reads "Default (Opus 5.5)" once a run of the role reported what Claude Code picked, and
 * plain "Default" before one has. Each choice saves as it is made.
 */
export const ModelsSection = ({ project }: { project: Project }) => {
  const settings = useSettingsAutosave(project);
  const reported = project.reportedRuntime;
  return (
    <div data-testid="settings-models" className="flex flex-col gap-6">
      <RolePickers kind="coordinator" settings={settings} reported={reported.coordinator} />
      <RolePickers kind="thread" settings={settings} reported={reported.thread} />
    </div>
  );
};

const RolePickers = ({
  kind,
  settings,
  reported,
}: {
  kind: Kind;
  settings: AutosaveSettings;
  reported: ReportedRuntime;
}) => {
  const role = ROLES[kind];
  const preference = settings.value(kind);
  const efforts = effortOptions(preference);
  // Model and effort are one setting; the row the person last changed says when it is saved.
  const [changed, setChanged] = useState<"model" | "effort">("model");
  const status = settings.state(kind);

  return (
    <SettingsGroup testId={`settings-${kind}-runtime`} title={role.group}>
      <SettingRow
        label="Model"
        description={role.model}
        htmlFor={`settings-${kind}-model`}
        status={changed === "model" ? status : undefined}
        control={
          <Select
            value={preference.model ?? USE_DEFAULT}
            onValueChange={(model) => {
              setChanged("model");
              settings.set(kind, changeModel(preference, model === USE_DEFAULT ? null : model));
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
              <SelectItem value={USE_DEFAULT}>{defaultModelLabel(reported)}</SelectItem>
              {modelOptions(preference).map((model) => (
                <SelectItem key={model} value={model}>
                  {formatRuntimeModelLabel(model)}
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
            value={preference.effort ?? USE_DEFAULT}
            onValueChange={(effort) => {
              setChanged("effort");
              settings.set(kind, {
                ...preference,
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
                {defaultEffortLabel(preference.provider, reported)}
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

// A model the catalog does not list (set by hand or by another tool) stays selectable, so
// opening the settings never shows something the project is not using.
const modelOptions = ({ provider, model }: RuntimePreference): readonly string[] => {
  const catalog = getRuntimeModelOptions(provider);
  return model && !catalog.includes(model) ? [model, ...catalog] : catalog;
};

// Not every model accepts every effort level; "use default" is judged against the default model.
const effortOptions = ({ provider, model }: RuntimePreference) =>
  getThinkingOptions(provider, model ?? getDefaultRuntimeModel(provider, ""));

/** A new model keeps the effort only if that model accepts it, otherwise the effort falls back to its default. */
const changeModel = (preference: RuntimePreference, model: string | null): RuntimePreference => {
  const next = { ...preference, model };
  const accepted = effortOptions(next).some((option) => option.value === preference.effort);
  return accepted ? next : { ...next, effort: null };
};
