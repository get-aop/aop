import { XIcon } from "lucide-react";
import { useState } from "react";

const DISMISSED_STORAGE_KEY = "aop:usage-tip-dismissed:v1";

const USAGE_TIP = "Projects can run several threads at once and draw down your usage faster.";

/**
 * A word above the coordinator's composer on what threads cost: they run side by side, so a
 * project spends usage faster than one chat. It shows on every project until the person closes
 * it, and this browser then never shows it again.
 */
export const UsageTip = () => {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <div
      data-testid="usage-tip"
      role="note"
      className="mb-2 flex items-center gap-3 rounded-row bg-raised py-2 pr-1.5 pl-3.5 text-body text-text"
    >
      <p className="min-w-0 flex-1">{USAGE_TIP}</p>
      <button
        type="button"
        data-testid="usage-tip-dismiss"
        aria-label="Dismiss tip"
        onClick={dismiss}
        className="grid size-10 shrink-0 place-items-center rounded-row text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text sm:size-7"
      >
        <XIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
};

const readDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const writeDismissed = (): void => {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, "true");
  } catch {
    // Storage blocked: the tip stays closed until the chat is opened again.
  }
};
