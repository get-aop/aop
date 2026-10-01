import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import type { SettingsDraft } from "./use-settings-draft";

/** One titled group of settings on a settings screen. */
export const SettingsBlock = ({
  title,
  description,
  testId,
  tone = "default",
  children,
}: {
  title: string;
  description?: ReactNode;
  testId?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) => (
  <section
    data-testid={testId}
    className="flex flex-col gap-3 border-b border-border py-5 first:pt-0 last:border-b-0"
  >
    <div className="flex flex-col gap-0.5">
      <h2
        className={cn(
          "text-[13px] font-semibold",
          tone === "danger" ? "text-blocked" : "text-text",
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="max-w-xl text-[12.5px] leading-relaxed text-text-subtle">{description}</p>
      ) : null}
    </div>
    {children}
  </section>
);

/** A heading over a run of setting rows, with an optional line under it. */
export const SettingsHeading = ({
  title,
  description,
}: {
  title: string;
  description?: ReactNode;
}) => (
  <div className="flex flex-col gap-0.5 pt-6 pb-1 first:pt-0">
    <h3 className="text-[14px] font-medium text-text">{title}</h3>
    {description ? (
      <p className="max-w-xl text-[12.5px] leading-relaxed text-text-subtle">{description}</p>
    ) : null}
  </div>
);

/**
 * One setting: what it is on the left, the control on the right. On a narrow screen the control
 * drops under the words. `below` is for what belongs to the setting but is not its control,
 * such as a warning about the chosen value.
 */
export const SettingRow = ({
  label,
  description,
  htmlFor,
  testId,
  control,
  below,
}: {
  label: string;
  description?: ReactNode;
  /** The control's id, so the label focuses it. */
  htmlFor?: string;
  testId?: string;
  control?: ReactNode;
  below?: ReactNode;
}) => (
  <div data-testid={testId} className="flex flex-col gap-2.5 py-3">
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13.5px] text-text">
            {label}
          </label>
        ) : (
          <span className="text-[13.5px] text-text">{label}</span>
        )}
        {description ? (
          <p className="text-[12.5px] leading-relaxed text-text-subtle">{description}</p>
        ) : null}
      </div>
      {control ? <div className="flex shrink-0 items-center sm:justify-end">{control}</div> : null}
    </div>
    {below}
  </div>
);

/** The width of a select on the right of a setting row, or the full width under it on a phone. */
export const ROW_SELECT_CLASS = "w-full sm:w-64";

/** Pins to the bottom of the screen; its Save button submits the form it sits in. */
export const SaveBar = ({
  draft,
  blocked = false,
}: {
  draft: SettingsDraft;
  /** The form has a mistake the person must fix first. */
  blocked?: boolean;
}) => (
  <div
    data-testid="settings-save-bar"
    data-dirty={draft.dirty}
    className="sticky bottom-0 z-10 -mx-6 mt-3 flex items-center gap-2 border-t border-border bg-surface/95 px-6 py-3 backdrop-blur-sm"
  >
    {draft.error ? (
      <p role="alert" data-testid="settings-error" className="flex-1 text-[12.5px] text-blocked">
        {draft.error}
      </p>
    ) : (
      <p
        data-testid="settings-save-state"
        className="flex-1 text-[12.5px] text-text-subtle"
        aria-live="polite"
      >
        {draft.dirty ? "You have unsaved changes." : "Everything is saved."}
      </p>
    )}
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="settings-discard"
      disabled={!draft.dirty || draft.saving}
      onClick={draft.discard}
    >
      Discard
    </Button>
    <Button
      type="submit"
      size="sm"
      data-testid="settings-save"
      disabled={!draft.dirty || draft.saving || blocked}
    >
      {draft.saving ? "Saving…" : "Save changes"}
    </Button>
  </div>
);
