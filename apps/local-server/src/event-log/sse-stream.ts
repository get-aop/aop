import type { SSEStreamingApi } from "hono/streaming";

/**
 * The frame's SSE `id`: left out to take the helper's next counter value, a number to name it
 * (a stream resumed from a durable log uses the log's ids), or `null` to send none, which
 * leaves the id the browser would resume from untouched.
 */
export type SSEFrameId = number | null;

export interface SSEStreamHelper {
  sendEvent: <T>(type: string, data: T, id?: SSEFrameId) => Promise<boolean>;
  sendRaw: (type: string, data: string, id?: SSEFrameId) => Promise<boolean>;
  setNextEventId: (id: number) => void;
  registerCleanup: (fn: () => void) => void;
  runCleanup: () => void;
  isCleanedUp: () => boolean;
}

export const createSSEStreamHelper = (
  stream: SSEStreamingApi,
  startEventId = 0,
): SSEStreamHelper => {
  let eventId = startEventId;
  const cleanupFns: (() => void)[] = [];
  let cleanedUp = false;
  let writeQueue = Promise.resolve();

  const runCleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const fn of cleanupFns) {
      fn();
    }
    cleanupFns.length = 0;
  };

  stream.onAbort(runCleanup);

  const writeOnce = async (type: string, data: string, id?: SSEFrameId): Promise<boolean> => {
    if (cleanedUp) return false;
    try {
      await stream.writeSSE({
        data,
        event: type,
        id: id === null ? undefined : String(id ?? eventId++),
      });
      return true;
    } catch {
      runCleanup();
      return false;
    }
  };

  // Serialize every write so concurrent senders (connected, replay, live, ping)
  // cannot interleave SSE frames or race event IDs.
  const sendRaw = (type: string, data: string, id?: SSEFrameId): Promise<boolean> => {
    const result = writeQueue.then(() => writeOnce(type, data, id));
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    sendEvent: <T>(type: string, data: T, id?: SSEFrameId): Promise<boolean> => {
      return sendRaw(type, JSON.stringify(data), id);
    },

    sendRaw,

    setNextEventId: (id: number): void => {
      eventId = id;
    },

    registerCleanup: (fn: () => void): void => {
      cleanupFns.push(fn);
    },

    runCleanup,

    isCleanedUp: () => cleanedUp,
  };
};
