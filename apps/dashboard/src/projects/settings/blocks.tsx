import { CheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/ui/spinner";
import type { SaveState } from "./use-settings-autosave";

/** One titled group of settings on a settings screen (memory, repositories, usage). */
export const SettingsBlock = ({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description?: ReactNode;
  testId?: string;
  children: ReactNode;
}) => (
  <section
    data-testid={testId}
    className="flex flex-col gap-3 border-b border-border py-6 first:pt-0 last:border-b-0"
  >
    <GroupHeading title={title} description={description} />
    {children}
  </section>
);

/**
 * A run of setting rows in one bordered box, as the host's Settings draws them: an optional title
 * and line above, a divider between rows. `danger` is for the actions that cannot be undone.
 */
export const SettingsGroup = ({
  title,
  description,
  testId,
  tone = "default",
  children,
}: {
  title?: string;
  description?: ReactNode;
  testId?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) => (
  <section data-testid={testId} className="flex flex-col gap-2.5">
    {title ? <GroupHeading title={title} description={description} tone={tone} /> : null}
    <div
      className={cn(
        "flex flex-col divide-y rounded-card border bg-raised/40",
        tone === "danger" ? "divide-blocked/20 border-blocked/30" : "divide-border border-border",
      )}
    >
      {children}
    </div>
  </section>
);

const GroupHeading = ({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description?: ReactNode;
  tone?: "default" | "danger";
}) => (
  <div className="flex flex-col gap-1">
    <h3
      className={cn("text-[13px] font-semibold", tone === "danger" ? "text-blocked" : "text-text")}
    >
      {title}
    </h3>
    {description ? (
      <p className="max-w-xl text-[12.5px] leading-relaxed text-text-subtle">{description}</p>
    ) : null}
  </div>
);

/**
 * One setting: what it is on the left, the control on the right, its save state beside its name.
 * `stacked` puts the control under the words, for a field that needs the width (a text area). On
 * a narrow screen every control drops under the words. `below` is for what belongs to the setting
 * but is not its control, such as a note about the chosen value.
 */
export const SettingRow = ({
  label,
  description,
  htmlFor,
  testId,
  control,
  stacked = false,
  status,
  below,
}: {
  label: string;
  description?: ReactNode;
  /** The control's id, so the label focuses it. */
  htmlFor?: string;
  testId?: string;
  control?: ReactNode;
  stacked?: boolean;
  status?: SaveState;
  below?: ReactNode;
}) => (
  <div data-testid={testId} data-setting-row="" className="flex flex-col gap-3 px-4 py-3.5">
    <div
      className={cn(
        "flex flex-col gap-3",
        !stacked && "sm:flex-row sm:items-center sm:justify-between sm:gap-8",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-h-5 items-center gap-2.5">
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-[13.5px] font-medium text-text">
              {label}
            </label>
          ) : (
            <span className="text-[13.5px] font-medium text-text">{label}</span>
          )}
          {status ? <SaveStatus state={status} /> : null}
        </div>
        {description ? (
          <p className="max-w-xl text-[12.5px] leading-relaxed text-text-subtle">{description}</p>
        ) : null}
      </div>
      {control ? (
        <div className={cn("flex min-w-0 items-center", !stacked && "shrink-0 sm:justify-end")}>
          {control}
        </div>
      ) : null}
    </div>
    {status?.phase === "error" ? (
      <p role="alert" data-testid="settings-error" className="text-[12.5px] text-blocked">
        {status.message}
      </p>
    ) : null}
    {below}
  </div>
);

/** The width of a select on the right of a setting row, or the full width under it on a phone. */
export const ROW_SELECT_CLASS = "w-full sm:w-64";

/** "Saving…" while a change is on its way, "Saved" for a moment once the host has it. */
export const SaveStatus = ({ state }: { state: SaveState }) => (
  <span
    data-testid="settings-save-state"
    data-phase={state.phase}
    aria-live="polite"
    className="flex items-center gap-1 text-[11.5px] text-text-subtle"
  >
    {state.phase === "saving" ? (
      <>
        <Spinner className="size-3" />
        Saving…
      </>
    ) : null}
    {state.phase === "saved" ? (
      <>
        <CheckIcon aria-hidden="true" className="size-3 text-ok" />
        Saved
      </>
    ) : null}
  </span>
);

/**
 * A short line about a setting's value, sized to what it says: `info` for context, `warn` for a
 * value that lowers a guard. One per setting, never a stack of them.
 */
export const SettingNote = ({
  tone = "info",
  testId,
  title,
  children,
}: {
  tone?: "info" | "warn";
  testId?: string;
  title?: string;
  children: ReactNode;
}) => (
  <div
    data-testid={testId}
    data-tone={tone}
    className={cn(
      "flex gap-2.5 rounded-row border px-3 py-2.5 text-[12.5px] leading-relaxed",
      tone === "warn" ? "border-waiting/25 bg-waiting/[0.06]" : "border-border bg-hover",
    )}
  >
    {tone === "warn" ? (
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-waiting" />
    ) : (
      <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
    )}
    <div className="flex min-w-0 flex-col gap-0.5">
      {title ? <p className="font-medium text-text">{title}</p> : null}
      <div className="text-text-muted">{children}</div>
    </div>
  </div>
);
