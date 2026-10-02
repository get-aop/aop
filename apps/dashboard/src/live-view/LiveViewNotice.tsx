import { MonitorIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { showLiveView, shownSession, useLiveViewState } from "./live-view-store";

/**
 * In the top bar while a thread uses computer use and the person closed the live view: brings it
 * back. Says nothing otherwise, and nothing to a viewer the `live_view` setting leaves out.
 */
export const LiveViewNotice = ({ className }: { className?: string }) => {
  const state = useLiveViewState();
  const session = shownSession(state);
  if (!session || !state.closed) return null;
  return (
    <button
      type="button"
      data-testid="live-view-show"
      title={`Show live view: ${session.title}`}
      aria-label="Show live view"
      onClick={showLiveView}
      className={className}
    >
      <MonitorIcon className="size-4 shrink-0" strokeWidth={1.7} />
      <span className={cn("hidden @3xl:inline")}>Live view</span>
    </button>
  );
};
