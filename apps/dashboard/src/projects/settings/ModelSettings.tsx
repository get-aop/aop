import {
  formatRuntimeModelLabel,
  getDefaultRuntimeModel,
  getRuntimeModelOptions,
  getThinkingOptions,
  type RuntimePreference,
} from "@aop/common";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import type { SettingsDraft } from "./use-settings-draft";

// A Radix select item cannot have an empty value, and null ("use the provider's default") needs one.
const USE_DEFAULT = "default";

type Kind = "coordinator" | "thread";

/** Model and effort for the coordinator and for the threads, each with "Use default". */
export const ModelSettings = ({ draft }: { draft: SettingsDraft }) => (
  <div className="grid gap-5 sm:grid-cols-2">
    <KindPicker
      kind="coordinator"
      title="Coordinator"
      hint="Reads every message and decides what to do. It rarely needs much thinking, so a low effort keeps it quick."
      draft={draft}
    />
    <KindPicker
      kind="thread"
      title="Threads"
      hint="Do the work. Every new turn of every thread uses these; a running turn finishes with what it started with."
      draft={draft}
    />
  </div>
);

const KindPicker = ({
  kind,
  title,
  hint,
  draft,
}: {
  kind: Kind;
  title: string;
  hint: string;
  draft: SettingsDraft;
}) => {
  const preference = draft.value(kind);
  const efforts = effortOptions(preference);

  return (
    <div data-testid={`settings-${kind}-runtime`} className="flex flex-col gap-2.5">
      <div>
        <h3 className="text-[12.5px] font-medium text-text">{title}</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-text-subtle">{hint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`settings-${kind}-model`} className="text-[12px] text-text-muted">
          Model
        </Label>
        <Select
          value={preference.model ?? USE_DEFAULT}
          onValueChange={(model) =>
            draft.set(kind, changeModel(preference, model === USE_DEFAULT ? null : model))
          }
        >
          <SelectTrigger id={`settings-${kind}-model`} data-testid={`settings-${kind}-model`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={USE_DEFAULT}>Use default</SelectItem>
            {modelOptions(preference).map((model) => (
              <SelectItem key={model} value={model}>
                {formatRuntimeModelLabel(model)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`settings-${kind}-effort`} className="text-[12px] text-text-muted">
          Effort
        </Label>
        <Select
          value={preference.effort ?? USE_DEFAULT}
          onValueChange={(effort) =>
            draft.set(kind, {
              ...preference,
              effort: efforts.find((option) => option.value === effort)?.value ?? null,
            })
          }
        >
          <SelectTrigger id={`settings-${kind}-effort`} data-testid={`settings-${kind}-effort`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={USE_DEFAULT}>Use default</SelectItem>
            {efforts.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
