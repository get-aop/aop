import { cuaWaitingLabel } from "@aop/common";
import { HourglassIcon, MonitorIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { threadLeasePlace, useCuaLease } from "../live-view/cua-lease";

/**
 * A thread's place with the host's computer-use lease, on its card: a quiet "Using computer use"
 * while it holds it, or its place in line while it waits for another thread to give it back.
 * Nothing when it does neither.
 */
export const ThreadCuaChip = ({ threadId }: { threadId: string }) => {
  const place = threadLeasePlace(useCuaLease(), threadId);
  if (!place) return null;
  const waiting = place.state === "waiting";
  return (
    <span
      data-testid="thread-cua-chip"
      data-cua-state={place.state}
      className={cn(
        "inline-flex w-fit items-center gap-1 text-meta",
        waiting ? "font-medium text-waiting" : "text-text-subtle",
      )}
    >
      {waiting ? (
        <HourglassIcon aria-hidden="true" className="size-3 shrink-0" />
      ) : (
        <MonitorIcon aria-hidden="true" className="size-3 shrink-0" />
      )}
      {waiting ? cuaWaitingLabel(place.position) : "Using computer use"}
    </span>
  );
};
