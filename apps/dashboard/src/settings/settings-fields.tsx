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
    label: "Chat",
    keys: ["chat_global_instructions"],
  },
  {
    label: "Remote server",
    keys: ["server_url", "api_key"],
  },
];

export const SETTING_META: Record<string, SettingMeta> = {
  chat_global_instructions: {
    label: "Global instructions",
    description:
      "Applied behind the scenes on every chat turn (for example “be concise, no jargon”). Not shown in the message transcript.",
    type: "textarea",
    rows: 4,
  },
  server_url: { label: "Server URL", description: "Remote server URL", type: "text" },
  api_key: { label: "API Key", description: "Remote server API key", type: "password" },
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
  onChange: (key: string, value: string) => void;
  isLast: boolean;
}

export const SettingRow = ({ settingKey, value, options, onChange, isLast }: SettingRowProps) => {
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

      <div className={stacked ? "w-full" : "flex shrink-0 items-center gap-2"}>
        <SettingInput
          id={inputId}
          meta={meta}
          value={value}
          onChange={(nextValue: string) => onChange(settingKey, nextValue)}
        />
      </div>
    </div>
  );
};

interface SettingInputProps {
  id: string;
  meta: SettingMeta;
  value: string;
  onChange: (value: string) => void;
}

const SettingInput = ({ id, meta, value, onChange }: SettingInputProps) => {
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

  return (
    <div className="relative">
      <Input
        id={id}
        type={meta.type === "password" ? "password" : "text"}
        inputMode={meta.type === "number" ? "numeric" : undefined}
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
};
