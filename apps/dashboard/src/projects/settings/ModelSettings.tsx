import {
  formatRuntimeModelLabel,
  getDefaultRuntimeModel,
  getRuntimeModelOptions,
  getThinkingOptions,
  type Project,
  type ReportedRuntime,
  type RuntimePreference,
} from "@aop/common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { defaultEffortLabel, defaultModelLabel } from "../chat/runtime-options";
import { ROW_SELECT_CLASS, SettingRow } from "./blocks";
import type { SettingsDraft } from "./use-settings-draft";

// A Radix select item cannot have an empty value, and null ("use default": no flag is passed) needs one.
const USE_DEFAULT = "default";

type Kind = "coordinator" | "thread";

const ROLES: Record<Kind, { title: string; model: string; effort: string }> = {
  coordinator: {
    title: "Coordinator",
    model: "Model for reading every message and deciding what to do.",
    effort: "It rarely needs much thinking, so a low effort keeps it quick.",
  },
  thread: {
    title: "Thread",
    model: "Model for new threads. A new thread starts on these and keeps them for its whole life.",
    effort: "Effort for new threads. A change here applies to the threads you start next.",
  },
};

/**
 * Model and effort for the coordinator and for the threads, one row each. The "use default"
 * choice reads "Default (Opus 5.5)" once a run of the role reported what Claude Code picked, and
 * plain "Default" before one has.
 */
export const ModelSettings = ({
  draft,
  reported,
}: {
  draft: SettingsDraft;
  reported: Project["reportedRuntime"];
}) => (
  <>
    <RolePickers kind="coordinator" draft={draft} reported={reported.coordinator} />
    <RolePickers kind="thread" draft={draft} reported={reported.thread} />
  </>
);

const RolePickers = ({
  kind,
  draft,
  reported,
}: {
  kind: Kind;
  draft: SettingsDraft;
  reported: ReportedRuntime;
}) => {
  const role = ROLES[kind];
  const preference = draft.value(kind);
  const efforts = effortOptions(preference);

  return (
    <div data-testid={`settings-${kind}-runtime`} className="flex flex-col">
      <SettingRow
        label={`${role.title} model`}
        description={role.model}
        htmlFor={`settings-${kind}-model`}
        control={
          <Select
            value={preference.model ?? USE_DEFAULT}
            onValueChange={(model) =>
              draft.set(kind, changeModel(preference, model === USE_DEFAULT ? null : model))
            }
          >
            <SelectTrigger
              id={`settings-${kind}-model`}
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
        label={`${role.title} effort`}
        description={role.effort}
        htmlFor={`settings-${kind}-effort`}
        control={
          <Select
            value={preference.effort ?? USE_DEFAULT}
            onValueChange={(effort) =>
              draft.set(kind, {
                ...preference,
                effort: efforts.find((option) => option.value === effort)?.value ?? null,
              })
            }
          >
            <SelectTrigger
              id={`settings-${kind}-effort`}
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
    </div>
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
