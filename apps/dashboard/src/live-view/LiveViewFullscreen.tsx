import type { LiveViewSession } from "@aop/common";
import { PictureInPicture2Icon } from "lucide-react";
import { useEffect, useRef } from "react";
import { FramePicture, LiveDot, SessionSwitcher, ThreadTitle } from "./LiveViewParts";
import { setLiveViewFullscreen } from "./live-view-store";
import type { LiveFrames } from "./use-live-frames";

/**
 * The live view over the whole app, the picture as large as fits with its aspect ratio kept.
 * "Picture in picture" or Escape turns it back into the popup; so does following the thread's
 * link, which then shows the thread under it.
 */
export const LiveViewFullscreen = ({
  session,
  sessions,
  frames,
}: {
  session: LiveViewSession;
  sessions: LiveViewSession[];
  frames: LiveFrames;
}) => {
  const backButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setLiveViewFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section
      data-testid="live-view-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={`Live view of the host's screen: ${session.title}`}
      className="fixed inset-0 z-40 flex flex-col bg-canvas/95 backdrop-blur-sm"
    >
      <header className="flex h-pane-header shrink-0 items-center gap-2 px-3 shadow-[inset_0_-1px_0_var(--color-border)]">
        <LiveDot ending={session.ending} />
        <ThreadTitle
          session={session}
          onNavigate={() => setLiveViewFullscreen(false)}
          className="text-[13px]"
        />
        <span className="hidden shrink-0 text-meta text-text-subtle sm:inline">View only</span>
        <span className="flex-1" />
        <SessionSwitcher sessions={sessions} current={session} />
        <button
          ref={backButton}
          type="button"
          data-testid="live-view-exit-fullscreen"
          title="Back to picture in picture (Esc)"
          aria-keyshortcuts="Escape"
          onClick={() => setLiveViewFullscreen(false)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-row border border-border-strong px-2.5 text-[12px] text-text hover:bg-hover [&_svg]:size-4"
        >
          <PictureInPicture2Icon />
          <span>Picture in picture</span>
        </button>
      </header>
      <div className="grid min-h-0 flex-1 place-items-center p-3">
        <FramePicture url={frames.url} error={frames.error} className="h-full w-full" />
      </div>
    </section>
  );
};
