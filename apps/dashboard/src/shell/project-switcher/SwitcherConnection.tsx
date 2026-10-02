import { cn } from "@/lib/cn";
import { AopLogoMark } from "../../components/brand/AopLogoMark";
import { ChannelTag } from "../../components/ChannelTag";
import { useHostVersion } from "../../hooks/useHostVersion";
import { useProjectsState } from "../../projects/ProjectsProvider";
import { type HostConnection, hostConnection } from "../../projects/selectors";

const CONNECTION_LABEL: Record<HostConnection, string> = {
  connected: "Connected",
  reconnecting: "Reconnecting…",
  offline: "Host unreachable",
};

export const CONNECTION_DOT: Record<HostConnection, string> = {
  connected: "bg-ok",
  reconnecting: "bg-waiting motion-safe:animate-[aop-pulse_1.4s_ease-in-out_infinite]",
  offline: "bg-blocked",
};

/**
 * The switcher's last line: AOP (and Nightly, in that build), how the page is doing with the
 * host and the host's release. It opens About in the AOP settings.
 */
export const SwitcherConnection = ({ onAbout }: { onAbout: () => void }) => {
  const connection = hostConnection(useProjectsState());
  const version = useHostVersion();

  return (
    <button
      type="button"
      data-testid="connection-status"
      data-state={connection}
      title="About AOP"
      onClick={onAbout}
      className="flex h-9 shrink-0 items-center gap-1.5 border-t border-border px-3 text-left text-[11.5px] text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
    >
      <AopLogoMark size={14} />
      <span className="font-semibold text-text-muted">AOP</span>
      <ChannelTag />
      <span className="flex-1" />
      <span className={cn("size-1.5 rounded-full", CONNECTION_DOT[connection])} />
      <span>{CONNECTION_LABEL[connection]}</span>
      {version ? <span>· {version}</span> : null}
    </button>
  );
};
