import { Settings2Icon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAopUpdateStatus } from "../hooks/useAopUpdateStatus";
import type { HostConnection } from "../projects/selectors";
import { openSettingsDialog } from "./dialog-store";

const CONNECTION_LABEL: Record<HostConnection, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting…",
  offline: "Host unreachable",
};

const CONNECTION_DOT: Record<HostConnection, string> = {
  connected: "bg-ok",
  reconnecting: "bg-waiting motion-safe:animate-[aop-pulse_1.4s_ease-in-out_infinite]",
  offline: "bg-blocked",
};

/** Sidebar footer: Settings (⌘,), then the state of the connection to the host, its version and an update. */
export const SidebarFooterStatus = ({ connection }: { connection: HostConnection }) => {
  const update = useAopUpdateStatus();

  return (
    <div data-testid="sidebar-footer" className="flex flex-col gap-0.5 p-2">
      <button
        type="button"
        data-testid="sidebar-settings"
        onClick={() => openSettingsDialog("general")}
        className="flex h-8 items-center gap-2 rounded-row px-2 text-[13px] font-medium text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
      >
        <Settings2Icon className="size-4" strokeWidth={1.7} />
        <span className="flex-1 text-left">Settings</span>
        <kbd className="text-[11px] text-text-subtle">⌘,</kbd>
      </button>
      <div
        data-testid="connection-status"
        data-state={connection}
        className="flex items-center gap-1.5 px-2 pt-1.5 text-[11.5px] text-text-subtle"
      >
        <span className={cn("size-1.5 rounded-full", CONNECTION_DOT[connection])} />
        <span>{CONNECTION_LABEL[connection]}</span>
        {update.status ? <span>· v{update.status.currentVersion}</span> : null}
        {update.status?.updateAvailable ? (
          <>
            <span>·</span>
            <button
              type="button"
              data-testid="sidebar-update"
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
