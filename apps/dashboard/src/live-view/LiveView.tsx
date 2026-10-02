import type { LiveViewSession } from "@aop/common";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/cn";
import { LiveViewFullscreen } from "./LiveViewFullscreen";
import { FramePicture, LiveDot, SessionSwitcher, ThreadTitle } from "./LiveViewParts";
import {
  closeLiveView,
  setLiveViewFullscreen,
  setLiveViewMinimized,
  shownSession,
  useWatchedLiveView,
} from "./live-view-store";
import { popupWidth } from "./placement";
import { useLiveFrames } from "./use-live-frames";
import { usePopupPlacement, useViewport } from "./use-popup-placement";

/** Until the first frame says otherwise, the screen is taken to be 16:10. */
const DEFAULT_ASPECT = 10 / 16;
const HEADER_HEIGHT = 32;

/**
 * The live view of the host's screen while a thread uses computer use: a small window floating
 * over the app (picture-in-picture), or the same picture full screen. View-only: nothing done
 * here reaches the host's screen. It shows only when the host says this viewer gets it (the
 * `live_view` setting) and a thread is using CUA, and goes away a few seconds after that ends.
 */
export const LiveView = () => {
  const state = useWatchedLiveView();
  const session = shownSession(state);
  const visible = session !== null && !state.closed;
  const frames = useLiveFrames(visible && (state.fullscreen || !state.minimized));
  if (!session || !visible || !state.status) return null;
  const { sessions } = state.status;
  return state.fullscreen ? (
    <LiveViewFullscreen session={session} sessions={sessions} frames={frames} />
  ) : (
    <LiveViewPopup
      session={session}
      sessions={sessions}
      frames={frames}
      minimized={state.minimized}
    />
  );
};

const LiveViewPopup = ({
  session,
  sessions,
  frames,
  minimized,
}: {
  session: LiveViewSession;
  sessions: LiveViewSession[];
  frames: ReturnType<typeof useLiveFrames>;
  minimized: boolean;
}) => {
  const viewport = useViewport();
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const width = Math.min(popupWidth(viewport.width), viewport.width);
  const height = HEADER_HEIGHT + (minimized ? 0 : Math.round(width * aspect));
  const openFullscreen = useCallback((target: EventTarget) => {
    if (target instanceof Element && target.closest("[data-live-view-body]")) {
      setLiveViewFullscreen(true);
    }
  }, []);
  const { position, dragging, corner, handlers } = usePopupPlacement(
    { width, height },
    viewport,
    openFullscreen,
  );

  return (
    <section
      data-testid="live-view-popup"
      data-corner={corner}
      aria-label={`Live view of the host's screen: ${session.title}`}
      style={{ left: position.x, top: position.y, width, height }}
      className={cn(
        "fixed z-40 flex touch-none select-none flex-col overflow-hidden rounded-lg border border-border-strong bg-surface shadow-[var(--shadow-3)]",
        dragging ? "cursor-grabbing" : "cursor-grab transition-[left,top] duration-150",
      )}
      {...handlers}
    >
      <header
        data-testid="live-view-header"
        className="flex shrink-0 items-center gap-1.5 border-b border-border px-2"
        style={{ height: HEADER_HEIGHT }}
      >
        <LiveDot ending={session.ending} />
        <ThreadTitle session={session} className="flex-1" />
        <SessionSwitcher sessions={sessions} current={session} />
        <HeaderButton
          testId="live-view-minimize"
          label={minimized ? "Show the picture" : "Minimize"}
          onClick={() => setLiveViewMinimized(!minimized)}
        >
          {minimized ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </HeaderButton>
        <HeaderButton testId="live-view-close" label="Close the live view" onClick={closeLiveView}>
          <XIcon />
        </HeaderButton>
      </header>
      {minimized ? null : (
        // A pointer click on the picture opens it full screen through the drag handler (a press
        // that moved is a drag, not a click); the keyboard's Enter or Space comes here.
        <button
          type="button"
          data-live-view-body
          data-testid="live-view-body"
          aria-label="Open the live view full screen"
          title="Open full screen"
          onClick={(event) => {
            if (event.detail === 0) setLiveViewFullscreen(true);
          }}
          className="grid min-h-0 flex-1 cursor-[inherit] place-items-center bg-black"
        >
          <FramePicture
            url={frames.url}
            error={frames.error}
            onAspect={setAspect}
            className="h-full w-full"
          />
        </button>
      )}
    </section>
  );
};

export const HeaderButton = ({
  testId,
  label,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    data-testid={testId}
    aria-label={label}
    title={label}
    onClick={onClick}
    className="grid size-6 shrink-0 place-items-center rounded-row text-text-subtle hover:bg-hover hover:text-text [&_svg]:size-3.5"
  >
    {children}
  </button>
);
