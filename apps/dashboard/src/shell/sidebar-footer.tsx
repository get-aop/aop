import { Settings2Icon } from "lucide-react";
import { cn } from "@/lib/cn";
import { CliUpdateDot } from "../agent-clis/AgentCliPanel";
import { pendingCliUpdates } from "../agent-clis/agent-cli-store";
import { useAgentCliStatus } from "../agent-clis/use-agent-clis";
import { useHostVersion } from "../hooks/useHostVersion";
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

/** Sidebar footer: Settings (⌘,), then the state of the connection to the host and its version. */
export const SidebarFooterStatus = ({ connection }: { connection: HostConnection }) => {
  const version = useHostVersion();

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
      <CliUpdateNotice />
      <div
        data-testid="connection-status"
        data-state={connection}
        className="flex items-center gap-1.5 px-2 pt-1.5 text-[11.5px] text-text-subtle"
      >
        <span className={cn("size-1.5 rounded-full", CONNECTION_DOT[connection])} />
        <span>{CONNECTION_LABEL[connection]}</span>
        {version ? <span>· {version}</span> : null}
      </div>
    </div>
  );
};

/**
 * A line under Settings while an agent CLI has a newer version out: noticeable without a bar
 * across the screen, since Claude Code ships several times a week. It opens the Runtimes panel.
 */
const CliUpdateNotice = () => {
  const pending = pendingCliUpdates(useAgentCliStatus({ poll: true }).data);
  const [first] = pending;
  if (!first) return null;
  const label =
    pending.length === 1
      ? `${first.label} ${first.latest} available`
      : `${pending.length} CLI updates available`;
  return (
    <button
      type="button"
      data-testid="sidebar-cli-update"
      onClick={() => openSettingsDialog("runtimes")}
      className="flex h-7 items-center gap-2 rounded-row px-2 text-left text-[12px] text-running transition-colors duration-[120ms] hover:bg-hover"
    >
      <CliUpdateDot className="mx-[5px]" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
};
