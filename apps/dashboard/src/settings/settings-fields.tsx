import { buildChannel, type RuntimeConfigurationProvider } from "@aop/common";
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
    label: "Computer use",
    keys: ["live_view"],
  },
  {
    label: "Updates",
    keys: ["update_check", "update_auto_apply"],
  },
  {
    label: "Agent CLIs",
    keys: ["agent_cli_check_interval_minutes", "agent_cli_auto_update"],
  },
  {
    label: "Library",
    keys: ["library_retention_days", "library_project_cap_mb", "library_host_cap_mb"],
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
  live_view: {
    label: "Live view of the host's screen",
    description:
      "While a thread uses computer use, a small window shows the host's screen live; click it for full screen. View only: nothing you do there reaches the host. “Remote viewers” shows it only on a device other than the host itself, such as the desktop app connected to this host.",
    type: "select",
    options: [
      { value: "off", label: "Off" },
      { value: "remote", label: "Remote viewers only" },
      { value: "always", label: "Always" },
    ],
  },
  update_check: {
    label: "Check for updates",
    description:
      buildChannel().id === "nightly"
        ? "Every hour the host looks for a newer nightly build of main and shows a notice here."
        : "Once a day the host looks for a newer AOP release on GitHub and shows a notice here. It never installs anything without you.",
    type: "toggle",
  },
  update_auto_apply: {
    label: "Install nightly builds automatically",
    description:
      "When a newer nightly is out, the host installs it and restarts once no turn is running. Turn it off to stay on this build; Update now still works.",
    type: "toggle",
  },
  agent_cli_check_interval_minutes: {
    label: "Check for CLI updates every",
    description:
      "How often the host looks for a newer Claude Code release (and once shortly after it starts). 0 turns the check off. Updating is under Settings › Runtimes.",
    type: "number",
    suffix: "min",
  },
  agent_cli_auto_update: {
    label: "Update CLIs automatically",
    description:
      "When a check finds a newer version, the host installs it. A native install updates right away; a package-manager install waits until no turn is running. Running turns are never interrupted.",
    type: "toggle",
  },
  library_retention_days: {
    label: "Keep chat attachments and agent files for",
    description:
      "The default for every project. After this many days the daily cleanup removes images sent in chat and files agents saved, unless pinned. Uploads are kept. 0 keeps everything.",
    type: "number",
    suffix: "days",
  },
  library_project_cap_mb: {
    label: "Library size per project",
    description:
      "The default for every project. Over it, the least recently used chat attachments and agent files go first; pinned files and uploads are never removed. 0 is no cap.",
    type: "number",
    suffix: "MB",
  },
  library_host_cap_mb: {
    label: "Library size on this host",
    description:
      "Every project's Library together. Over it, the daily cleanup removes the least recently used chat attachments and agent files across projects. 0 is no cap.",
    type: "number",
    suffix: "MB",
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

// Only AOP Nightly installs builds by itself; a stable host never reads update_auto_apply.
export const isSettingVisible = (
  settingKey: string,
  _values: Record<string, string>,
  _runtimeConfigurations: RuntimeConfigurationProvider[] = [],
): boolean => settingKey !== "update_auto_apply" || buildChannel().id === "nightly";

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
      className={meta.type === "number" ? "w-24 text-right" : "w-52"}
      // The suffix sits inside the field, so the value stops short of it, however long it is.
      style={meta.suffix ? { paddingRight: `calc(${meta.suffix.length}ch + 0.875rem)` } : undefined}
    />
    {meta.suffix ? (
      <span className="text-[11.5px] pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-subtle">
        {meta.suffix}
      </span>
    ) : null}
  </div>
);
