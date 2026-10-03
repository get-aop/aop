import { ShieldOffIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { CliUpdateDot } from "../agent-clis/AgentCliPanel";
import { pendingCliUpdates, skipsPermissions, useAgentClis } from "../agent-clis/agent-cli-store";
import { useAgentCliStatus } from "../agent-clis/use-agent-clis";
import { LiveViewNotice } from "../live-view/LiveViewNotice";
import { PlanUsageMeter } from "../plan-usage/PlanUsageMeter";
import { useProjectsState } from "../projects/ProjectsProvider";
import { hostConnection } from "../projects/selectors";
import { openSettingsDialog } from "./dialog-store";
import { CONNECTION_DOT } from "./project-switcher/SwitcherConnection";

/**
 * The far end of every top bar: host-wide state. The live view's "Show" button while it is
 * closed and a thread uses computer use, a newer agent CLI and agents that skip
 * permission checks (each opens the Runtimes settings), a host out of reach, then the Claude
 * plan's usage meter. The notices drop their words when the bar is narrow; their titles keep them.
 */
export const ShellStatus = ({ testId }: { testId: string }) => (
  <div data-testid={testId} className="ml-auto flex shrink-0 items-center gap-0.5">
    <LiveViewNotice className={noticeClass} />
    <CliUpdateNotice />
    <PermissionBypassNotice />
    <HostOfflineNotice />
    <PlanUsageMeter />
  </div>
);

const noticeClass =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-row px-1.5 text-meta transition-colors @md:px-2 duration-[120ms] hover:bg-hover";

/**
 * Shown while an agent CLI has a newer version out: noticeable without a bar across the screen,
 * since Claude Code ships several times a week.
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
      data-testid="cli-update-notice"
      title={label}
      aria-label={label}
      onClick={() => openSettingsDialog("runtimes")}
      className={cn(noticeClass, "text-running")}
    >
      <CliUpdateDot className="m-[5px]" />
      <span className="hidden max-w-48 truncate @5xl:inline">{label}</span>
    </button>
  );
};

/**
 * Shown for as long as the agents this host starts skip permission checks, on every screen, so
 * it is never forgotten on. The notice above keeps the shared status fresh.
 */
const PermissionBypassNotice = () => {
  if (!skipsPermissions(useAgentClis().data)) return null;
  return (
    <button
      type="button"
      data-testid="permission-bypass-notice"
      title="Permission checks off: agents run any command on this host without asking"
      aria-label="Permission checks off"
      onClick={() => openSettingsDialog("runtimes")}
      className={cn(noticeClass, "text-blocked")}
    >
      <ShieldOffIcon className="size-4 shrink-0" strokeWidth={1.7} />
      <span className="hidden @5xl:inline">Permission checks off</span>
    </button>
  );
};

/** The host has not answered lately. Reconnecting streams are each project's "Live" line's to say. */
const HostOfflineNotice = () => {
  const connection = hostConnection(useProjectsState());
  if (connection !== "offline") return null;
  return (
    <span
      data-testid="host-offline-notice"
      role="status"
      title="Host unreachable"
      className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-meta text-blocked"
    >
      <span className={cn("size-1.5 rounded-full", CONNECTION_DOT.offline)} />
      <span className="hidden @3xl:inline">Host unreachable</span>
    </span>
  );
};
