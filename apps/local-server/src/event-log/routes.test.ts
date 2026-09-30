import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../app.ts";
import { openSse } from "./sse-test-client.ts";
import { createStreamHarness, type StreamHarness, threadRemoved } from "./test-utils.ts";

describe("GET /api/projects/:projectId/stream", () => {
  let h: StreamHarness;

  beforeEach(async () => {
    h = await createStreamHarness();
  });

  afterEach(async () => {
    await h.dispose();
  });

  describe("cursor", () => {
    test.each([
      "?after=abc",
      "?after=-1",
      "?after=1.5",
      "?after=1e3",
      "?after=",
      "?after=1234567890123456",
    ])("%s is refused before any stream starts", async (query) => {
      const response = await fetch(h.streamUrl("p1", query));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "after must be an event id: a non-negative integer",
      });
    });

    test("a malformed Last-Event-ID is refused too", async () => {
      const response = await fetch(h.streamUrl("p1"), {
        headers: { "Last-Event-ID": "not-an-id" },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Last-Event-ID must be an event id: a non-negative integer",
      });
    });

    test("an empty Last-Event-ID means the browser has none, so the stream starts fresh", async () => {
      const connection = await h.connect("p1", "", { "Last-Event-ID": "" });
      await connection.waitForFrames("resync", 1);

      expect(connection.status).toBe(200);
    });

    test("a cursor of 0 replays from the beginning without a resync", async () => {
      const entry = await h.publisher.publish(threadRemoved("p1", "t1"));

      const connection = await h.connect("p1", "?after=0");
      await connection.waitForFrames("entry", 1);

      expect(connection.entries()).toEqual([entry]);
      expect(connection.frames.some((frame) => frame.event === "resync")).toBe(false);
    });
  });

  test("answers 404 for a project that does not exist", async () => {
    const response = await fetch(h.streamUrl("no-such-project"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Project not found" });
  });

  describe("in the app", () => {
    let server: ReturnType<typeof Bun.serve>;
    let base: string;
    const asProxy = { "x-forwarded-for": "100.64.0.7", "x-forwarded-proto": "https" };

    beforeEach(() => {
      const app = createApp({
        ctx: h.ctx,
        startTimeMs: Date.now(),
        eventsSSEOptions: { heartbeatIntervalMs: 20 },
      });
      server = Bun.serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
      base = `http://127.0.0.1:${server.port}`;
    });

    afterEach(() => {
      server.stop(true);
    });

    test("is served through the app's middleware as frames that arrive as they are sent", async () => {
      const connection = await openSse(`${base}/api/projects/p1/stream`, {
        "Accept-Encoding": "gzip",
      });
      await connection.waitForFrames("resync", 1);
      const entry = await h.publisher.publish(threadRemoved("p1", "t1"));
      await connection.waitForFrames("entry", 1);
      await connection.waitForFrames("heartbeat", 3);

      expect(connection.headers.get("content-type")).toContain("text/event-stream");
      expect(connection.headers.get("content-encoding")).toBeNull();
      expect(connection.entries()).toEqual([entry]);
    });

    test("is closed to a caller with no credentials, open to a paired device by cookie, and ended when the device is revoked", async () => {
      expect((await fetch(`${base}/api/projects/p1/stream`, { headers: asProxy })).status).toBe(
        401,
      );
      const { code } = (await (
        await fetch(`${base}/api/auth/pairing-codes`, { method: "POST" })
      ).json()) as {
        code: string;
      };
      const paired = await fetch(`${base}/api/auth/pair`, {
        method: "POST",
        headers: { ...asProxy, "content-type": "application/json" },
        body: JSON.stringify({ code, name: "Work Mac" }),
      });
      const { device, token } = (await paired.json()) as { device: { id: string }; token: string };

      // An EventSource cannot send Authorization, so a browser streams with the session cookie.
      const connection = await openSse(`${base}/api/projects/p1/stream`, {
        ...asProxy,
        cookie: `aop_device=${token}`,
      });
      await connection.waitForFrames("resync", 1);
      const entry = await h.publisher.publish(threadRemoved("p1", "t1"));
      await connection.waitForFrames("entry", 1);
      await fetch(`${base}/api/auth/devices/${device.id}`, { method: "DELETE" });
      await connection.ended;

      expect(connection.status).toBe(200);
      expect(connection.entries()).toEqual([entry]);
    });
  });
});
