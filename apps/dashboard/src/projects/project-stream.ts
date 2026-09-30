import {
  type EventLogEntry,
  EventLogEntrySchema,
  type MessageDelta,
  MessageDeltaSchema,
  PROJECT_STREAM_EVENTS,
  type Resync,
  ResyncSchema,
} from "@aop/common";
import { apiUrl, isRemoteHost } from "../api/host";

/** `EventSource.readyState` values; the constants are not on the test environment's global. */
const READY_STATE_CLOSED = 2;

/** Seconds between attempts to open a stream the browser gave up on; the last delay repeats. */
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export type StreamState = "connecting" | "live" | "reconnecting";

export interface StreamHandlers {
  onState: (state: StreamState) => void;
  onEntry: (entry: EventLogEntry) => void;
  onDelta: (delta: MessageDelta) => void;
  /** The page must refetch the project: the log cannot catch it up, or an entry was unreadable. */
  onResync: (resync: Resync) => void;
  /** The browser closed the connection for good (an HTTP error, as while the host restarts). */
  onRejected?: () => void;
}

export interface StreamDeps {
  createSource: (url: string, withCredentials: boolean) => EventSource;
  /** Runs `run` after `delayMs`; returns what cancels it. */
  schedule: (run: () => void, delayMs: number) => () => void;
}

export const browserStreamDeps: StreamDeps = {
  createSource: (url, withCredentials) => new EventSource(url, { withCredentials }),
  schedule: (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
};

export const projectStreamUrl = (projectId: string, after: number | null): string =>
  apiUrl(
    `/projects/${encodeURIComponent(projectId)}/stream${after === null ? "" : `?after=${after}`}`,
  );

/**
 * One project's event stream. While the browser is reconnecting it resumes by itself with
 * `Last-Event-ID`, so nothing here has to. It stops trying when it gives up, which is what
 * it does on any HTTP error; this opens a fresh source with `?after=` set to the newest entry
 * seen, so the host replays exactly what was missed.
 */
export const connectProjectStream = (
  projectId: string,
  handlers: StreamHandlers,
  deps: StreamDeps = browserStreamDeps,
): { close: () => void } => {
  let source: EventSource | null = null;
  let cursor: number | null = null;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  let closed = false;

  const remember = (id: number) => {
    if (Number.isSafeInteger(id) && (cursor === null || id > cursor)) cursor = id;
  };

  const open = () => {
    handlers.onState(cursor === null && failures === 0 ? "connecting" : "reconnecting");
    const current = deps.createSource(projectStreamUrl(projectId, cursor), isRemoteHost());
    source = current;

    current.onopen = () => {
      failures = 0;
      handlers.onState("live");
    };
    current.onerror = () => {
      if (closed || source !== current) return;
      handlers.onState("reconnecting");
      if (current.readyState !== READY_STATE_CLOSED) return;
      current.close();
      handlers.onRejected?.();
      const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
      failures += 1;
      cancelRetry = deps.schedule(open, delay);
    };

    current.addEventListener(PROJECT_STREAM_EVENTS.entry, (event) => {
      const entry = parseJson(EventLogEntrySchema, (event as MessageEvent).data);
      if (!entry) {
        // An entry this build cannot read is one it would silently miss: refetch instead.
        handlers.onResync({ cursor: cursor ?? 0, reason: "unreadable" });
        return;
      }
      remember(entry.id);
      handlers.onEntry(entry);
    });
    current.addEventListener(PROJECT_STREAM_EVENTS.resync, (event) => {
      const resync = parseJson(ResyncSchema, (event as MessageEvent).data);
      if (!resync) return;
      // Set, not raised: after a restored database the log's newest entry is older than ours.
      cursor = resync.cursor;
      handlers.onResync(resync);
    });
    current.addEventListener(PROJECT_STREAM_EVENTS.delta, (event) => {
      const delta = parseJson(MessageDeltaSchema, (event as MessageEvent).data);
      if (delta) handlers.onDelta(delta);
    });
    current.addEventListener(PROJECT_STREAM_EVENTS.heartbeat, () => handlers.onState("live"));
  };

  open();

  return {
    close: () => {
      closed = true;
      cancelRetry?.();
      source?.close();
      source = null;
    },
  };
};

const parseJson = <T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  data: string,
): T | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
