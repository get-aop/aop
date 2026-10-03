import {
  type CuaLeaseState,
  EMPTY_CUA_LEASE,
  type LiveViewCapture,
  type LiveViewMode,
  type LiveViewStatus,
  type LiveViewViewer,
  liveViewShownTo,
} from "@aop/common";
import type { CuaActivity } from "./cua-activity.ts";
import type { Frame, ScreenCapture, StartCapture } from "./screen-capture.ts";

/**
 * The live view of the host's screen while a thread uses CUA. View-only: nothing a viewer does
 * reaches the screen.
 *
 * The capture runs only while both hold: a CUA session is active, and a viewer has asked for a
 * frame within `VIEWER_TTL_MS`. Viewers poll for frames (short requests, so the view never holds
 * one of the browser's few connections to the host), and each request renews the lease; the
 * first starts the capture and the capture stops a few seconds after the last, or as soon as no
 * CUA session is active. A capture that failed is retried after `RETRY_MS`, not on every poll.
 */
export interface LiveViewService {
  status: (viewer: LiveViewViewer) => Promise<LiveViewStatus>;
  frame: (viewer: LiveViewViewer) => Promise<FrameAnswer>;
  /** Stops a running capture (host shutdown). */
  stop: () => void;
}

export type FrameAnswer =
  | { kind: "frame"; frame: Frame }
  | { kind: "refused"; status: 403 | 404 | 503; code: FrameRefusal; error: string };

export type FrameRefusal =
  | "LIVE_VIEW_OFF"
  | "LIVE_VIEW_IDLE"
  | "LIVE_VIEW_STARTING"
  | "LIVE_VIEW_UNAVAILABLE";

export const VIEWER_TTL_MS = 5_000;
export const RETRY_MS = 15_000;
const TICK_MS = 1_000;

export interface LiveViewDeps {
  activity: CuaActivity;
  startCapture: StartCapture;
  readMode: () => Promise<LiveViewMode>;
  /** The computer-use lease, reported with the status; nobody holds it when absent. */
  readLease?: () => CuaLeaseState;
  now?: () => number;
  /** How the idle check is scheduled; tests drive it by hand. */
  every?: (ms: number, run: () => void) => () => void;
}

export const createLiveViewService = (deps: LiveViewDeps): LiveViewService => {
  const now = deps.now ?? Date.now;
  const every = deps.every ?? defaultEvery;
  let capture: ScreenCapture | null = null;
  let stopTicking: (() => void) | null = null;
  let lastViewerAt = 0;
  /** The last frame of the last capture, served while its session lingers. */
  let lastFrame: Frame | null = null;
  let unavailable: { detail: string; at: number } | null = null;

  const stopCapture = () => {
    lastFrame = capture?.latest() ?? lastFrame;
    capture?.stop();
    capture = null;
    stopTicking?.();
    stopTicking = null;
  };

  // A capture outlives neither its last viewer nor the CUA session, nor its own ffmpeg.
  const tick = () => {
    if (!capture) return;
    const failure = capture.failure();
    if (failure) {
      unavailable = { detail: failure, at: now() };
      stopCapture();
      return;
    }
    if (now() - lastViewerAt > VIEWER_TTL_MS || !deps.activity.anyActive()) stopCapture();
  };

  const ensureCapture = () => {
    if (capture || !deps.activity.anyActive()) return;
    if (unavailable && now() - unavailable.at < RETRY_MS) return;
    const started = deps.startCapture();
    if ("unavailable" in started) {
      unavailable = { detail: started.unavailable, at: now() };
      return;
    }
    unavailable = null;
    lastFrame = null;
    capture = started;
    stopTicking = every(TICK_MS, tick);
  };

  const captureState = (): LiveViewCapture => {
    if (capture) return { state: capture.latest() ? "live" : "starting", detail: null };
    if (unavailable) return { state: "unavailable", detail: unavailable.detail };
    return { state: "idle", detail: null };
  };

  // Why a viewer gets no picture: the host cannot capture, the capture is starting, or nobody uses CUA.
  const noFrame = (): FrameAnswer => {
    if (unavailable) {
      return refused(503, "LIVE_VIEW_UNAVAILABLE", `Live view unavailable: ${unavailable.detail}`);
    }
    if (capture) return refused(503, "LIVE_VIEW_STARTING", "The capture is starting.");
    return refused(404, "LIVE_VIEW_IDLE", "No thread is using computer use.");
  };

  return {
    status: async (viewer) => {
      const mode = await deps.readMode();
      tick();
      const lease = deps.readLease?.() ?? EMPTY_CUA_LEASE;
      // A thread whose CUA call waits in line has called a tool but is not on the screen yet.
      const waiting = new Set(lease.queue.map((waiter) => waiter.threadId));
      return {
        mode,
        viewer,
        shown: liveViewShownTo(mode, viewer),
        sessions: deps.activity.sessions().filter((session) => !waiting.has(session.threadId)),
        capture: captureState(),
        lease,
      };
    },
    frame: async (viewer) => {
      if (!liveViewShownTo(await deps.readMode(), viewer)) {
        return refused(403, "LIVE_VIEW_OFF", "The live view is off for this viewer.");
      }
      lastViewerAt = now();
      tick();
      ensureCapture();
      const frame = capture?.latest() ?? (deps.activity.sessions().length > 0 ? lastFrame : null);
      return frame ? { kind: "frame", frame } : noFrame();
    },
    stop: stopCapture,
  };
};

const refused = (status: 403 | 404 | 503, code: FrameRefusal, error: string): FrameAnswer => ({
  kind: "refused",
  status,
  code,
  error,
});

const defaultEvery = (ms: number, run: () => void): (() => void) => {
  const timer = setInterval(run, ms);
  timer.unref?.();
  return () => clearInterval(timer);
};
