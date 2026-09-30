import { readSseBody } from "@aop/common";
import { authHeaders, getHostConfig } from "./host";

/**
 * What a stream consumer needs from a live connection. The browser's `EventSource` is one; the
 * `fetch` reader below is the other, for a host that authenticates with a bearer token.
 */
export interface StreamSource {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  readonly readyState: number;
  addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
  close: () => void;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/**
 * Opens a stream to the host. A client with a device token reads it with `fetch`, because an
 * `EventSource` cannot set an `Authorization` header and the session cookie, its only way in,
 * is `SameSite=Strict` and never sent from another origin. Anything else (the dashboard the
 * host serves itself, or the desktop app talking to its own Mac as the owner) uses a plain
 * `EventSource`.
 */
export const openHostEventSource = (url: string, withCredentials: boolean): StreamSource =>
  getHostConfig().token === null
    ? new EventSource(url, { withCredentials })
    : createFetchEventSource(url, { headers: authHeaders() });

interface FetchEventSourceOptions {
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/**
 * An event stream read with `fetch`. It behaves like an `EventSource` that never reconnects on
 * its own: when the connection ends, for any reason, it is `CLOSED` and reports an error. The
 * consumer opens a new one from its own cursor, which is how project streams already resume.
 */
export const createFetchEventSource = (
  url: string,
  { headers, fetchImpl = fetch }: FetchEventSourceOptions,
): StreamSource => {
  const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  const abort = new AbortController();
  let readyState = CONNECTING;

  const source: StreamSource = {
    onopen: null,
    onerror: null,
    get readyState() {
      return readyState;
    },
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close: () => {
      readyState = CLOSED;
      abort.abort();
    },
  };

  const fail = () => {
    if (readyState === CLOSED) return;
    readyState = CLOSED;
    source.onerror?.(new Event("error"));
  };

  const run = async () => {
    const response = await fetchImpl(url, {
      headers: { ...headers, Accept: "text/event-stream" },
      cache: "no-store",
      credentials: "omit",
      signal: abort.signal,
    });
    if (!response.ok || !response.body || !isEventStream(response)) return fail();
    if (readyState === CLOSED) return;
    readyState = OPEN;
    source.onopen?.(new Event("open"));
    await readSseBody(response.body, (message) => {
      const event = new MessageEvent(message.event, {
        data: message.data,
        lastEventId: message.id ?? "",
      });
      // As with a real EventSource, a listener that throws must not end the stream.
      for (const listener of listeners.get(message.event) ?? []) {
        try {
          listener(event);
        } catch (error) {
          reportError(error);
        }
      }
    });
    fail();
  };

  // A closed source raised no error to report; any other failure ends the connection.
  run().catch(fail);
  return source;
};

const isEventStream = (response: Response): boolean =>
  response.headers.get("content-type")?.includes("text/event-stream") ?? false;
