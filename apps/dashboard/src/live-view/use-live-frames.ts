import { useEffect, useState } from "react";
import { fetchLiveFrame, type LiveFrame } from "../api/live-view";

/**
 * The host's screen as an object URL, polled while `enabled` and the page is visible. Each frame
 * is its own short request, so the view never holds one of the browser's few connections to the
 * host. Stopping (unmount, hidden page, `enabled` off) ends the host's lease, and the host stops
 * capturing a few seconds later.
 */
export interface LiveFrames {
  url: string | null;
  /** Why there is no picture: the host's own words ("Live view unavailable: …"). */
  error: string | null;
}

export const MIN_DELAY_MS = 250;
export const IDLE_DELAY_MS = 1_000;
const STARTING_DELAY_MS = 500;
const REFUSED_DELAY_MS = 3_000;
export const FAILED_DELAY_MS = 5_000;

export const useLiveFrames = (enabled: boolean): LiveFrames => {
  const [frames, setFrames] = useState<LiveFrames>({ url: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    const stop = startFramePoller(setFrames);
    return () => {
      stop();
      setFrames({ url: null, error: null });
    };
  }, [enabled]);

  return frames;
};

/**
 * How long to wait before the next frame request. The pace adapts: as fast as `MIN_DELAY_MS`
 * while the picture changes and the link keeps up (never faster than twice the last request
 * took), slowing towards `IDLE_DELAY_MS` while the host answers "unchanged". `idle` is the wait
 * the unchanged answers have grown to so far.
 */
export const nextDelay = (
  answer: LiveFrame | null,
  tookMs: number,
  idle: number,
): { delay: number; idle: number } => {
  const linkPace = Math.max(MIN_DELAY_MS, tookMs * 2);
  if (answer === null) return { delay: FAILED_DELAY_MS, idle };
  if (answer.kind === "frame")
    return { delay: Math.min(IDLE_DELAY_MS, linkPace), idle: MIN_DELAY_MS };
  if (answer.kind === "unchanged") {
    const grown = Math.min(IDLE_DELAY_MS, idle * 1.5);
    return { delay: Math.max(grown, linkPace), idle: grown };
  }
  if (answer.code === "LIVE_VIEW_STARTING") return { delay: STARTING_DELAY_MS, idle };
  if (answer.code === "LIVE_VIEW_UNAVAILABLE") return { delay: FAILED_DELAY_MS, idle };
  return { delay: REFUSED_DELAY_MS, idle };
};

// One loop of requests; returns its stop. It pauses while the page is hidden.
const startFramePoller = (show: (frames: LiveFrames) => void): (() => void) => {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  const shown: Shown = { url: null, etag: null };
  let idle = MIN_DELAY_MS;

  const schedule = (ms: number) => {
    if (abort.signal.aborted || document.visibilityState === "hidden") return;
    timer = setTimeout(() => void poll(), ms);
  };

  const poll = async () => {
    timer = null;
    inFlight = true;
    const started = performance.now();
    const answer = await fetchLiveFrame(shown.etag, abort.signal).catch(() => null);
    inFlight = false;
    if (abort.signal.aborted) return;
    if (answer) applyAnswer(shown, answer, show);
    const next = nextDelay(answer, performance.now() - started, idle);
    idle = next.idle;
    schedule(next.delay);
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (timer) clearTimeout(timer);
      timer = null;
    } else if (timer === null && !inFlight) {
      void poll();
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  void poll();
  return () => {
    abort.abort();
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    if (shown.url) URL.revokeObjectURL(shown.url);
  };
};

/** The picture on screen and the ETag of the frame it came from. */
interface Shown {
  url: string | null;
  etag: string | null;
}

// A new frame replaces the picture (and frees the old one); a refusal says why, except while the
// capture is starting, when the last picture or "Connecting" stays.
const applyAnswer = (shown: Shown, answer: LiveFrame, show: (frames: LiveFrames) => void) => {
  if (answer.kind === "frame") {
    if (shown.url) URL.revokeObjectURL(shown.url);
    shown.url = URL.createObjectURL(answer.blob);
    shown.etag = answer.etag;
    show({ url: shown.url, error: null });
  } else if (answer.kind === "refused" && answer.code !== "LIVE_VIEW_STARTING") {
    show({ url: shown.url, error: answer.code === "LIVE_VIEW_UNAVAILABLE" ? answer.error : null });
  }
};
