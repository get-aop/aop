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
    className="sticky bottom-0 z-10 -mx-6 flex items-center gap-2 border-t border-border bg-canvas/95 px-6 py-3 backdrop-blur-sm"
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
