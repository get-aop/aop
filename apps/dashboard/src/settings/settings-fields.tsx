import type { RuntimeConfigurationProvider } from "@aop/common";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { Textarea } from "@/ui/textarea";

export interface SettingMeta {
  label: string;
  description: string;
  type: "number" | "text" | "password" | "toggle" | "select" | "textarea";
  suffix?: string;
  options?: { value: string; label: string; sub?: string }[];
  /** Optional rows for textarea controls. */
  rows?: number;
}

/**
 * Setting groups + per-key metadata. Kept beside the field renderers so the
 * Settings page shell only orchestrates state and never owns control styling.
 */
export const SETTINGS_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: "Profile",
    keys: ["display_name"],
  },
  {
    label: "Chat",
    keys: ["chat_global_instructions"],
  },
  {
    label: "Runs",
    keys: ["max_concurrent_runs"],
  },
  {
    label: "Updates",
    keys: ["update_check"],
  },
];

export const SETTING_META: Record<string, SettingMeta> = {
  display_name: {
    label: "Your name",
    description:
      "What a project's overview greets you by, using the first word. Leave it empty for a plain “Welcome back.”",
    type: "text",
  },
  max_concurrent_runs: {
    label: "Concurrent thread runs",
    description:
      "How many thread turns this host runs at once. The rest wait their turn, in order. Raising it starts waiting turns at once; lowering it never stops a turn that is running.",
    type: "number",
  },
  update_check: {
    label: "Check for updates",
    description:
      "Once a day the host looks for a newer AOP release on GitHub and shows a notice here. It never installs anything without you.",
    type: "toggle",
  },
  chat_global_instructions: {
    label: "Global instructions",
    description:
      "Applied behind the scenes on every chat turn (for example “be concise, no jargon”). Not shown in the message transcript.",
    type: "textarea",
    rows: 4,
  },
};

export const resolveSettingOptions = (
  settingKey: string,
  _values: Record<string, string>,
  _runtimeConfigurations: RuntimeConfigurationProvider[] = [],
): SettingMeta["options"] => SETTING_META[settingKey]?.options;

export const isSettingVisible = (
  _settingKey: string,
  _values: Record<string, string>,
  _runtimeConfigurations: RuntimeConfigurationProvider[] = [],
): boolean => true;

interface SettingRowProps {
  settingKey: string;
  value: string;
  options?: { value: string; label: string; sub?: string }[];
  /** Why the value cannot be saved; the row says so under the field and the value is not saved. */
  error?: string | null;
  onChange: (key: string, value: string) => void;
  isLast: boolean;
}

export const SettingRow = ({
  settingKey,
  value,
  options,
  error = null,
  onChange,
  isLast,
}: SettingRowProps) => {
  const baseMeta = SETTING_META[settingKey] ?? { label: settingKey, description: "", type: "text" };
  const meta =
    baseMeta.type === "select"
      ? { ...baseMeta, options: options ?? baseMeta.options ?? [] }
      : baseMeta;
  const inputId = `setting-${settingKey}`;
  const stacked = meta.type === "textarea";

  return (
    <div
      className={`${stacked ? "flex flex-col gap-3 px-4 py-3.5" : "flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-6"} ${isLast ? "" : "border-b border-border"}`}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="text-[12px] font-medium block text-text">
          {meta.label}
        </label>
        <p className="text-[11.5px] mt-1 text-text-muted">{meta.description}</p>
      </div>

      <div className={stacked ? "w-full" : "flex shrink-0 flex-col items-end gap-1.5"}>
        <SettingInput
          id={inputId}
          meta={meta}
          value={value}
          invalid={error !== null}
          onChange={(nextValue: string) => onChange(settingKey, nextValue)}
        />
        {error ? (
          <p
            id={`${inputId}-error`}
            role="alert"
            data-testid={`setting-error-${settingKey}`}
            className="text-[11.5px] text-blocked"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
};

interface SettingInputProps {
  id: string;
  meta: SettingMeta;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}

const SettingInput = ({ id, meta, value, invalid, onChange }: SettingInputProps) => {
  if (meta.type === "toggle") {
    return (
      <Switch
        id={id}
        aria-label={meta.label}
        checked={value === "true"}
        onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
      />
    );
  }

  if (meta.type === "select" && meta.options) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={meta.label} className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {meta.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (meta.type === "textarea") {
    return (
      <Textarea
        id={id}
        aria-label={meta.label}
        value={value}
        rows={meta.rows ?? 4}
        onChange={(event) => onChange(event.target.value)}
        className="w-full max-w-2xl resize-y"
        placeholder="Optional. Example: Be concise. Avoid jargon."
      />
    );
  }

  return <LineInput id={id} meta={meta} value={value} invalid={invalid} onChange={onChange} />;
};

const LineInput = ({ id, meta, value, invalid, onChange }: SettingInputProps) => (
  <div className="relative">
    <Input
      id={id}
      data-testid={id}
      type={meta.type === "password" ? "password" : "text"}
      inputMode={meta.type === "number" ? "numeric" : undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${meta.type === "number" ? "w-24 text-right" : "w-52"} ${meta.suffix ? "pr-6" : ""}`}
    />
    {meta.suffix ? (
      <span className="text-[11.5px] pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-subtle">
        {meta.suffix}
      </span>
    ) : null}
  </div>
);
