import {
  type ChatRuntimeActionIntent,
  type ChatRuntimeActionSelection,
  getDefaultRuntimeConfigurationModel,
  isWorkflowRuntimeProvider,
  type RuntimeConfigurationProvider,
  resolveRuntimeConfigurationReasoning,
  runtimeConfigurationSupportsFastMode,
  type WorkflowRuntimeReasoning,
} from "@aop/common";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";

const INTENT_LABELS: Record<ChatRuntimeActionIntent, string> = {
  implement: "implement",
  review: "review",
  audit: "audit",
  test: "run tests",
  security: "perform a security review",
};

export const QUICK_ACTION_INTENTS = new Set<ChatRuntimeActionIntent>([
  "implement",
  "review",
  "audit",
  "test",
  "security",
]);

export const quickActionIntent = (command: string): ChatRuntimeActionIntent | null => {
  const intent = command.trim().replace(/^\//, "") as ChatRuntimeActionIntent;
  return QUICK_ACTION_INTENTS.has(intent) ? intent : null;
};

export const createRuntimeAction = (
  intent: ChatRuntimeActionIntent,
  configuration: RuntimeConfigurationProvider,
): ChatRuntimeActionSelection | null => {
  if (!isWorkflowRuntimeProvider(configuration.driver)) return null;
  const model = getDefaultRuntimeConfigurationModel(configuration.models);
  if (!model) return null;
  return {
    id: crypto.randomUUID(),
    intent,
    runtimeConfigurationId: configuration.id,
    runtimeConfigurationName: configuration.name,
    provider: configuration.driver,
    model: model.model,
    reasoning: resolveRuntimeConfigurationReasoning(
      model.thinkingLevels,
      null,
      model.defaultThinkingLevel,
    ),
    fastMode: false,
    phase: intent === "implement" ? "writer" : "post-work",
  };
};

export const addRuntimeAction = (
  actions: ChatRuntimeActionSelection[],
  next: ChatRuntimeActionSelection,
): ChatRuntimeActionSelection[] => {
  const withoutDuplicate = actions.filter(
    (action) =>
      !(
        action.intent === next.intent &&
        action.runtimeConfigurationId === next.runtimeConfigurationId &&
        action.model === next.model &&
        action.reasoning === next.reasoning &&
        action.fastMode === next.fastMode
      ),
  );
  const withoutWriter =
    next.phase === "writer"
      ? withoutDuplicate.filter((action) => action.phase !== "writer")
      : withoutDuplicate;
  return next.phase === "writer" ? [next, ...withoutWriter] : [...withoutWriter, next];
};

export const ComposerRuntimeActionPicker = ({
  intent,
  configurations,
  onPick,
  onCancel,
}: {
  intent: ChatRuntimeActionIntent;
  configurations: RuntimeConfigurationProvider[];
  onPick: (configuration: RuntimeConfigurationProvider) => void;
  onCancel: () => void;
}) => (
  <div
    data-testid="composer-runtime-action-picker"
    className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-[var(--z-nav)] rounded-control border border-border bg-surface p-2 shadow-2"
  >
    <div className="flex items-center justify-between px-2 pb-2 text-[11px] text-text-subtle">
      <span>Choose a runtime to {INTENT_LABELS[intent]}</span>
      <button type="button" aria-label="Cancel Quick Action" onClick={onCancel}>
        ×
      </button>
    </div>
    <div className="flex flex-col gap-1">
      {configurations.map((configuration) => {
        const model = getDefaultRuntimeConfigurationModel(configuration.models);
        return (
          <button
            type="button"
            key={configuration.id}
            className="rounded-control px-3 py-2 text-left hover:bg-raised"
            onClick={() => onPick(configuration)}
          >
            {configuration.name}
            {model ? ` · ${model.description}` : ""}
          </button>
        );
      })}
    </div>
  </div>
);

export const ComposerRuntimeActionCards = ({
  actions,
  configurations,
  onChange,
}: {
  actions: ChatRuntimeActionSelection[];
  configurations: RuntimeConfigurationProvider[];
  onChange: (actions: ChatRuntimeActionSelection[]) => void;
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <>
      {actions.map((action) => {
        const runtime = configurations.find((item) => item.id === action.runtimeConfigurationId);
        const runtimeLabel = runtime?.name ?? action.provider;
        if (editingId === action.id && runtime) {
          return (
            <RuntimeActionControls
              key={action.id}
              action={action}
              configuration={runtime}
              onChange={(next) =>
                onChange(
                  actions.map((candidate) => (candidate.id === action.id ? next : candidate)),
                )
              }
              onConfirm={() => setEditingId(null)}
              onRemove={() => {
                setEditingId(null);
                onChange(actions.filter((candidate) => candidate.id !== action.id));
              }}
            />
          );
        }
        return (
          <div
            key={action.id}
            data-testid={`composer-runtime-action-${action.intent}`}
            className="flex items-center gap-2 rounded-control border border-border-bold bg-active px-3 py-2 text-sm text-text"
          >
            <button
              type="button"
              aria-label={`Configure ${action.intent} action`}
              onClick={() => setEditingId(action.id)}
              className="flex items-center gap-2 text-left"
            >
              <span>
                {runtimeLabel} will {INTENT_LABELS[action.intent]}
              </span>
              <span className="font-mono text-xs text-text-subtle">
                {action.model} · {action.reasoning}
                {action.fastMode ? " · fast" : ""}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Remove ${action.intent} action`}
              onClick={() => onChange(actions.filter((candidate) => candidate.id !== action.id))}
            >
              ×
            </button>
          </div>
        );
      })}
    </>
  );
};

const RuntimeActionControls = ({
  action,
  configuration,
  onChange,
  onConfirm,
  onRemove,
}: {
  action: ChatRuntimeActionSelection;
  configuration: RuntimeConfigurationProvider;
  onChange: (action: ChatRuntimeActionSelection) => void;
  onConfirm: () => void;
  onRemove: () => void;
}) => {
  const selectedModel =
    configuration.models.find((model) => model.model === action.model) ?? configuration.models[0];
  const modelOptions = configuration.models.map((model) => ({
    value: model.model,
    label: model.description,
  }));
  const thinkingOptions = (selectedModel?.thinkingLevels ?? []).map((reasoning) => ({
    value: reasoning,
    label: reasoning,
  }));

  const changeModel = (model: string) => {
    const nextModel = configuration.models.find((candidate) => candidate.model === model);
    if (!nextModel) return;
    onChange({
      ...action,
      model,
      reasoning: resolveRuntimeConfigurationReasoning(
        nextModel.thinkingLevels,
        null,
        nextModel.defaultThinkingLevel,
      ),
      fastMode: runtimeConfigurationSupportsFastMode(configuration, model)
        ? action.fastMode
        : false,
    });
  };

  return (
    <div
      data-testid={`composer-runtime-action-${action.intent}`}
      className="flex items-center gap-2 rounded-control border border-border-bold bg-active px-3 py-2 text-sm text-text"
    >
      <span className="font-semibold">{configuration.name}</span>
      <Select value={action.model} onValueChange={changeModel}>
        <SelectTrigger aria-label="Quick Action model" className="h-7 min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent side="top">
          {modelOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {thinkingOptions.length > 0 ? (
        <Select
          value={action.reasoning}
          onValueChange={(reasoning) =>
            onChange({ ...action, reasoning: reasoning as WorkflowRuntimeReasoning })
          }
        >
          <SelectTrigger aria-label="Quick Action thinking" className="h-7 min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top">
            {thinkingOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {runtimeConfigurationSupportsFastMode(configuration, action.model) ? (
        <label className="flex items-center gap-1.5 text-[11.5px] text-text">
          <input
            type="checkbox"
            aria-label="Quick Action fast mode"
            checked={action.fastMode}
            onChange={(event) => onChange({ ...action, fastMode: event.target.checked })}
          />
          Fast
        </label>
      ) : null}
      <button type="button" aria-label={`Confirm ${action.intent} action`} onClick={onConfirm}>
        Confirm
      </button>
      <button type="button" aria-label={`Remove ${action.intent} action`} onClick={onRemove}>
        ×
      </button>
    </div>
  );
};
