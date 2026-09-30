import { Settings2Icon } from "lucide-react";

import { useAopUpdateStatus } from "../hooks/useAopUpdateStatus";
import { openSettingsDialog } from "./dialog-store";

/**
 * Rail footer: Settings (⌘,) · status line
 * “Connected · vX.Y · Update”. Plain gray sans — never mono, never amber.
 */
export const RailFooter = ({ connected }: { connected: boolean }) => {
  const update = useAopUpdateStatus();

  return (
    <div data-testid="rail-footer" className="flex flex-col gap-0.5 p-2">
      <button
        type="button"
        data-testid="rail-footer-settings"
        onClick={() => openSettingsDialog("general")}
        className="flex h-8 items-center gap-2 rounded-row px-2 text-[13px] font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <Settings2Icon className="size-4" strokeWidth={1.7} />
        <span className="flex-1 text-left">Settings</span>
        <kbd className="text-[11px] text-text-subtle">⌘,</kbd>
      </button>
      <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[11.5px] text-text-subtle">
        <span
          data-testid="rail-footer-status-dot"
          className={`size-1.5 rounded-full ${connected ? "bg-ok" : "bg-blocked"}`}
        />
        <span>{connected ? "Connected" : "Disconnected"}</span>
        {update.status ? <span>· v{update.status.currentVersion}</span> : null}
        {update.status?.updateAvailable ? (
          <>
            <span>·</span>
            <button
              type="button"
              data-testid="rail-footer-update"
              onClick={() => void update.install()}
              disabled={update.installing}
              className="text-running hover:underline disabled:opacity-50"
            >
              {update.installing ? "Updating…" : "Update"}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
};
