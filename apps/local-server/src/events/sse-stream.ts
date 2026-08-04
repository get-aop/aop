import type { SSEStreamingApi } from "hono/streaming";

export interface SSEStreamHelper {
  sendEvent: <T>(type: string, data: T) => Promise<boolean>;
  sendRaw: (type: string, data: string) => Promise<boolean>;
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

  const writeOnce = async (type: string, data: string): Promise<boolean> => {
    if (cleanedUp) return false;
    try {
      await stream.writeSSE({
        data,
        event: type,
        id: String(eventId++),
      });
      return true;
    } catch {
      runCleanup();
      return false;
    }
  };

  // Serialize every write so concurrent senders (connected, replay, live, ping)
  // cannot interleave SSE frames or race event IDs.
  const sendRaw = (type: string, data: string): Promise<boolean> => {
    const result = writeQueue.then(() => writeOnce(type, data));
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    sendEvent: <T>(type: string, data: T): Promise<boolean> => {
      return sendRaw(type, JSON.stringify(data));
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
