import { ShieldOffIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { skipsPermissions, useAgentClis } from "../agent-clis/agent-cli-store";
import { LiveViewNotice } from "../live-view/LiveViewNotice";
import { PlanUsageMeter } from "../plan-usage/PlanUsageMeter";
import { useProjectsState } from "../projects/ProjectsProvider";
import { hostConnection } from "../projects/selectors";
import { UpdatesButton } from "../updates/UpdatesButton";
import { openSettingsDialog } from "./dialog-store";
import { CONNECTION_DOT } from "./project-switcher/SwitcherConnection";

/**
 * The far end of every top bar: host-wide state. The live view's "Show" button while it is
 * closed and a thread uses computer use, the Updates button (shown only when something can be
 * updated, is updating or failed), agents that skip permission checks (opens the Runtimes
 * settings), a host out of reach, then the Claude plan's usage meter. The notices drop their
 * words when the bar is narrow; their titles keep them.
 */
export const ShellStatus = ({ testId }: { testId: string }) => (
  <div data-testid={testId} className="ml-auto flex shrink-0 items-center gap-0.5">
    <LiveViewNotice className={noticeClass} />
    <UpdatesButton />
    <PermissionBypassNotice />
    <HostOfflineNotice />
    <PlanUsageMeter />
  </div>
);

const noticeClass =
  "flex h-8 shrink-0 items-center gap-1.5 rounded-row px-1.5 text-meta transition-colors @md:px-2 duration-[120ms] hover:bg-hover";

/**
 * Shown for as long as the agents this host starts skip permission checks, on every screen, so
 * it is never forgotten on. The Updates button keeps the shared CLI status fresh.
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
