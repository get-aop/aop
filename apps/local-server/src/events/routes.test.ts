import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { createApp } from "../app.ts";
import { createLoopbackApp } from "../auth/test-utils.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createTaskEventEmitter, type TaskEventEmitter } from "./task-events.ts";

interface SSEParsedEvent {
  event: string;
  data: string;
  id: string;
}

const parseSSELine = (line: string, parsed: SSEParsedEvent): void => {
  if (line.startsWith("event:")) parsed.event = line.slice(6).trim();
  else if (line.startsWith("data:")) parsed.data = line.slice(5).trim();
  else if (line.startsWith("id:")) parsed.id = line.slice(3).trim();
};

const parseSSEBlock = (block: string): SSEParsedEvent | null => {
  const parsed: SSEParsedEvent = { event: "", data: "", id: "" };
  for (const line of block.split("\n")) {
    parseSSELine(line, parsed);
  }
  return parsed.event || parsed.data ? parsed : null;
};

const parseSSEEvents = (text: string): SSEParsedEvent[] => {
  return text
    .split("\n\n")
    .filter((b) => b.trim())
    .map(parseSSEBlock)
    .filter((e): e is SSEParsedEvent => e !== null);
};

const collectChunks = async (
  reader: { read: () => Promise<{ value?: Uint8Array; done: boolean }> },
  maxReads: number,
  timeoutMs = 500,
): Promise<string> => {
  const decoder = new TextDecoder();
  let text = "";
  for (let i = 0; i < maxReads; i++) {
    const timeout = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), timeoutMs),
    );
    const result = await Promise.race([reader.read(), timeout]);
    if (result.value) text += decoder.decode(result.value);
    if (result.done) break;
  }
  return text;
};

describe("events/routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let emitter: TaskEventEmitter;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createTestDb();
    emitter = createTaskEventEmitter();
    ctx = createCommandContext(db, { taskEventEmitter: emitter });
    app = createLoopbackApp({ ctx, startTimeMs: Date.now() });
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /api/events", () => {
    test("returns SSE content-type", async () => {
      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      expect(res.headers.get("content-type")).toContain("text/event-stream");

      controller.abort();
    });

    test("sends the registered repos in the init event", async () => {
      await createTestRepo(db, "repo-1", "/path/to/repo");

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const text = await collectChunks(reader, 3);
      controller.abort();

      const initEvent = parseSSEEvents(text).find((e) => e.event === "init");
      expect(initEvent).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: already checked via expect
      const initData = JSON.parse(initEvent!.data);
      expect(initData.type).toBe("init");
      expect(initData.status.repos).toEqual([
        expect.objectContaining({ id: "repo-1", name: "repo" }),
      ]);
    });

    test("broadcasts host events emitted after the connection opened", async () => {
      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const { value: initValue } = await reader.read();
      let text = decoder.decode(initValue);

      emitter.emit({ type: "repo-removed", repoId: "repo-1" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      text += await collectChunks(reader, 3);
      controller.abort();

      const removed = parseSSEEvents(text).find((e) => e.event === "repo-removed");
      expect(removed).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: already checked via expect
      expect(JSON.parse(removed!.data)).toEqual({ type: "repo-removed", repoId: "repo-1" });
    });

    test("increments event IDs for each event", async () => {
      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const { value: initValue } = await reader.read();
      let text = decoder.decode(initValue);

      emitter.emit({ type: "data-reset" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      text += await collectChunks(reader, 3);
      controller.abort();

      const events = parseSSEEvents(text);
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.map((event) => Number(event.id))).toEqual(events.map((_, index) => index));
    });

    test("subscribes to event emitter on connection", async () => {
      const initialListenerCount = emitter.listenerCount();

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      await reader.read();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(emitter.listenerCount()).toBe(initialListenerCount + 1);

      controller.abort();
    });

    test("unsubscribes from event emitter when connection is aborted", async () => {
      const initialListenerCount = emitter.listenerCount();

      const controller = new AbortController();
      const res = await app.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      await reader.read();

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(emitter.listenerCount()).toBe(initialListenerCount + 1);

      controller.abort();
      await reader.cancel();

      // Wait for onAbort callback to execute
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(emitter.listenerCount()).toBe(initialListenerCount);
    });

    test("cleans up listeners on abort (no memory leak)", async () => {
      const initialListenerCount = emitter.listenerCount();

      // Open 15 SSE connections that are aborted - more than the default EventEmitter limit of 10
      // If listeners aren't cleaned up, this would trigger MaxListenersExceededWarning
      for (let i = 0; i < 15; i++) {
        const controller = new AbortController();
        const res = await app.request("/api/events", {
          signal: controller.signal,
        });

        // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
        const reader = res.body!.getReader();
        await reader.read();

        controller.abort();
        await reader.cancel();

        // Wait for cleanup to complete
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // If we got here without warnings, listeners are being cleaned up properly
      expect(emitter.listenerCount()).toBe(initialListenerCount);
    });
  });

  describe("heartbeat", () => {
    let heartbeatApp: ReturnType<typeof createApp>;

    beforeEach(() => {
      heartbeatApp = createLoopbackApp({
        ctx,
        startTimeMs: Date.now(),
        eventsSSEOptions: { heartbeatIntervalMs: 50 },
      });
    });

    test("sends heartbeat events at configured interval", async () => {
      const controller = new AbortController();
      const res = await heartbeatApp.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      // Read init event
      const { value: initValue } = await reader.read();
      text += decoder.decode(initValue);

      // Wait for heartbeat interval (50ms) plus buffer
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Read heartbeat event
      const { value: heartbeatValue } = await reader.read();
      text += decoder.decode(heartbeatValue);
      controller.abort();

      const events = parseSSEEvents(text);
      const heartbeatEvent = events.find((e) => e.event === "heartbeat");
      expect(heartbeatEvent).toBeDefined();
      expect(heartbeatEvent?.data).toBe("");
    });

    test("heartbeat increments event ID correctly", async () => {
      const controller = new AbortController();
      const res = await heartbeatApp.request("/api/events", {
        signal: controller.signal,
      });

      // biome-ignore lint/style/noNonNullAssertion: test code, body always exists
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";

      // Read init event (id: 0) and immediate heartbeat (id: 1)
      const { value: initValue } = await reader.read();
      text += decoder.decode(initValue);

      // Wait for interval heartbeat (id: 2)
      await new Promise((resolve) => setTimeout(resolve, 80));

      const { value: heartbeatValue } = await reader.read();
      text += decoder.decode(heartbeatValue);
      controller.abort();

      const events = parseSSEEvents(text);
      const initEvent = events.find((e) => e.event === "init");
      // Find heartbeats - there should be at least 2 (immediate + interval)
      const heartbeatEvents = events.filter((e) => e.event === "heartbeat");

      expect(initEvent?.id).toBe("0");
      expect(heartbeatEvents.length).toBeGreaterThanOrEqual(1);
      // First heartbeat is immediate (id: 1), subsequent are from interval
      expect(heartbeatEvents[0]?.id).toBe("1");
    });
  });
});
