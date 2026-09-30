import { type EventLogEntry, EventLogEntrySchema } from "@aop/common";

export interface SseFrame {
  event: string;
  /** The SSE `id` field; null when the frame carried none. */
  id: string | null;
  data: string;
}

export interface SseConnection {
  status: number;
  headers: Headers;
  frames: SseFrame[];
  /** Every `entry` frame received so far, parsed with the wire schema. */
  entries: () => EventLogEntry[];
  /** The first frame, from the start of the connection, that satisfies the predicate. */
  waitFor: (predicate: (frame: SseFrame) => boolean) => Promise<SseFrame>;
  /** Waits until at least `count` frames of `event` have arrived. */
  waitForFrames: (event: string, count: number) => Promise<SseFrame[]>;
  /** Resolves when the response ends, whether the server or the test ended it. */
  ended: Promise<void>;
  close: () => void;
}

const WAIT_MS = 3_000;

/** Opens `url` like an EventSource would and collects the frames until it is closed. */
export const openSse = async (
  url: string,
  headers: Record<string, string> = {},
): Promise<SseConnection> => {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  const frames: SseFrame[] = [];

  const waitUntil = async <T>(find: () => T | undefined, what: string): Promise<T> => {
    for (const deadline = Date.now() + WAIT_MS; Date.now() < deadline; await Bun.sleep(5)) {
      const found = find();
      if (found !== undefined) return found;
    }
    throw new Error(`No ${what} within ${WAIT_MS}ms. Received: ${JSON.stringify(frames)}`);
  };

  return {
    status: response.status,
    headers: response.headers,
    frames,
    entries: () =>
      frames
        .filter((frame) => frame.event === "entry")
        .map((frame) => EventLogEntrySchema.parse(JSON.parse(frame.data))),
    waitFor: (predicate) => waitUntil(() => frames.find(predicate), "matching frame"),
    waitForFrames: (event, count) =>
      waitUntil(() => {
        const found = frames.filter((frame) => frame.event === event);
        return found.length >= count ? found : undefined;
      }, `${count} ${event} frames`),
    ended: collectFrames(response.body, frames),
    close: () => controller.abort(),
  };
};

const collectFrames = async (
  body: ReadableStream<Uint8Array> | null,
  frames: SseFrame[],
): Promise<void> => {
  const reader = body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffered += decoder.decode(chunk.value, { stream: true });
      const blocks = buffered.split("\n\n");
      buffered = blocks.pop() ?? "";
      for (const block of blocks) {
        const frame = parseFrame(block);
        if (frame) frames.push(frame);
      }
    }
  } catch {
    // The test closed the connection.
  }
};

const parseFrame = (block: string): SseFrame | null => {
  const fields = block
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith(":"))
    .map((line) => {
      const [name = "", ...rest] = line.split(":");
      return { name, value: rest.join(":").replace(/^ /, "") };
    });
  if (fields.length === 0) return null;
  const fieldValue = (name: string) => fields.find((field) => field.name === name)?.value;
  return {
    event: fieldValue("event") ?? "message",
    id: fieldValue("id") ?? null,
    data: fields
      .filter((field) => field.name === "data")
      .map((field) => field.value)
      .join("\n"),
  };
};
