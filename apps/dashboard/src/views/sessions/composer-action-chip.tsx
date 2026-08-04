import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

export type ComposerActionChipTone = "offer" | "config" | "armed";

/**
 * Shared header chip above the composer canvas (outside the textarea).
 * Used for runtime delegation and $control — never paints inside the draft.
 */
export const ComposerActionChip = ({
  tone,
  testId,
  children,
  onDismiss,
  dismissLabel,
  onPrimaryClick,
}: {
  tone: ComposerActionChipTone;
  testId: string;
  children: ReactNode;
  onDismiss: () => void;
  dismissLabel: string;
  /** Whole-chip click (offer / reopen armed summary). */
  onPrimaryClick?: () => void;
}) => {
  const className =
    tone === "armed"
      ? "composer-action-chip composer-action-chip-armed"
      : tone === "config"
        ? "composer-action-chip composer-action-chip-config"
        : "composer-action-chip composer-action-chip-offer";

  const shellProps = {
    "data-testid": testId,
    "data-tone": tone,
    className,
  } as const;

  const dismissButton = (
    <button
      type="button"
      data-testid={`${testId}-dismiss`}
      aria-label={dismissLabel}
      title={dismissLabel}
      onClick={onDismiss}
      className="composer-action-chip-dismiss"
    >
      <XIcon className="size-3" strokeWidth={1.7} />
    </button>
  );

  if (!onPrimaryClick) {
    return (
      <div {...shellProps}>
        <div className="composer-action-chip-body">{children}</div>
        {dismissButton}
      </div>
    );
  }

  return (
    <div {...shellProps}>
      <button
        type="button"
        data-testid={`${testId}-primary`}
        onClick={onPrimaryClick}
        className="composer-action-chip-primary"
      >
        <span className="composer-action-chip-body">{children}</span>
      </button>
      {dismissButton}
    </div>
  );
};

export const formatActionModelSummary = (
  model: string,
  reasoning: string,
  fastMode?: boolean,
): string => {
  const parts = [model, reasoning];
  if (fastMode) parts.push("fast mode");
  return parts.join(" · ");
};
