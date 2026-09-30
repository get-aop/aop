import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { setManagedHostConfig } = await import("./host");
const { createFetchEventSource, openHostEventSource } = await import("./host-event-source");

const OPEN = 1;
const CLOSED = 2;

/** A response the test writes to as the host would, and can cut. */
const liveResponse = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    write: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    end: () => controller.close(),
    cut: () => controller.error(new TypeError("network error")),
  };
};

const fetchOf = (respond: (init?: RequestInit) => Response | Promise<Response>) =>
  (async (_url: string | URL | Request, init?: RequestInit) => respond(init)) as typeof fetch;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const openWith = (respond: (init?: RequestInit) => Response | Promise<Response>) => {
  const source = createFetchEventSource("https://h/api/s", {
    headers: {},
    fetchImpl: fetchOf(respond),
  });
  const failed = mock(() => {});
  source.onerror = failed;
  return { source, failed };
};

describe("createFetchEventSource", () => {
  test("sends the bearer token and asks for an event stream, without ambient credentials", async () => {
    const host = liveResponse();
    const fetchImpl = mock(
      async (_url: string | URL | Request, _init?: RequestInit) => host.response,
    );

    createFetchEventSource("https://mac.tail1234.ts.net/api/projects/p/stream?after=4", {
      headers: { Authorization: "Bearer aop_t" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await settle();

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://mac.tail1234.ts.net/api/projects/p/stream?after=4");
    expect(init?.headers).toEqual({ Authorization: "Bearer aop_t", Accept: "text/event-stream" });
    expect(init?.credentials).toBe("omit");
  });

  test("opens, then delivers each event to the listeners of its type with its id", async () => {
    const host = liveResponse();
    const { source } = openWith(() => host.response);
    const opened = mock(() => {});
    const entries: MessageEvent[] = [];
    const heartbeats: MessageEvent[] = [];
    source.onopen = opened;
    source.addEventListener("entry", (event) => entries.push(event));
    source.addEventListener("heartbeat", (event) => heartbeats.push(event));
    await settle();

    expect(source.readyState).toBe(OPEN);
    expect(opened).toHaveBeenCalledTimes(1);

    host.write('id: 9\nevent: entry\ndata: {"a":1}\n\nevent: heartbeat\ndata: {}\n\n');
    await settle();

    expect(entries.map((event) => [event.data, event.lastEventId])).toEqual([['{"a":1}', "9"]]);
    expect(heartbeats).toHaveLength(1);
  });

  test("is closed and reports an error when the host ends the stream, so the consumer resumes from its cursor", async () => {
    const host = liveResponse();
    const { source, failed } = openWith(() => host.response);
    await settle();

    host.end();
    await settle();

    expect(source.readyState).toBe(CLOSED);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  test("is closed and reports an error when the connection breaks", async () => {
    const host = liveResponse();
    const { source, failed } = openWith(() => host.response);
    await settle();

    host.cut();
    await settle();

    expect(source.readyState).toBe(CLOSED);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  test("gives up on an HTTP error or a reply that is not a stream, as an EventSource does", async () => {
    for (const response of [
      Response.json({ error: "Authentication required" }, { status: 401 }),
      new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    ]) {
      const { source, failed } = openWith(() => response);
      await settle();

      expect(source.readyState).toBe(CLOSED);
      expect(failed).toHaveBeenCalledTimes(1);
    }
  });

  test("reports an unreachable host as an error", async () => {
    const { source, failed } = openWith(() => {
      throw new TypeError("Failed to fetch");
    });
    await settle();

    expect(source.readyState).toBe(CLOSED);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  test("closing it stops the request and raises no error", async () => {
    const host = liveResponse();
    let signal: AbortSignal | null | undefined;
    const { source, failed } = openWith((init) => {
      signal = init?.signal;
      return host.response;
    });
    await settle();

    source.close();
    await settle();

    expect(signal?.aborted).toBe(true);
    expect(source.readyState).toBe(CLOSED);
    expect(failed).not.toHaveBeenCalled();
  });

  test("a listener that throws does not end the stream", async () => {
    const host = liveResponse();
    const { source } = openWith(() => host.response);
    const seen: string[] = [];
    const reported = mock(() => {});
    const originalReportError = globalThis.reportError;
    globalThis.reportError = reported;
    source.addEventListener("entry", () => {
      throw new Error("bad listener");
    });
    source.addEventListener("entry", (event) => seen.push(event.data));
    await settle();

    try {
      host.write("event: entry\ndata: 1\n\nevent: entry\ndata: 2\n\n");
      await settle();
    } finally {
      globalThis.reportError = originalReportError;
    }

    expect(seen).toEqual(["1", "2"]);
    expect(source.readyState).toBe(OPEN);
    expect(reported).toHaveBeenCalledTimes(2);
  });
});

describe("openHostEventSource", () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const nativeSources: { url: string; withCredentials: boolean }[] = [];

  beforeEach(() => {
    window.localStorage.clear();
    setManagedHostConfig(null);
    nativeSources.length = 0;
    globalThis.EventSource = class {
      constructor(url: string, init: { withCredentials: boolean }) {
        nativeSources.push({ url, withCredentials: init.withCredentials });
      }
    } as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    setManagedHostConfig(null);
  });

  test("uses the browser's EventSource and its cookie when there is no token", () => {
    openHostEventSource("/api/projects/p/stream", false);
    setManagedHostConfig({ baseUrl: "http://127.0.0.1:25150", token: null });
    openHostEventSource("http://127.0.0.1:25150/api/projects/p/stream", true);

    expect(nativeSources).toEqual([
      { url: "/api/projects/p/stream", withCredentials: false },
      { url: "http://127.0.0.1:25150/api/projects/p/stream", withCredentials: true },
    ]);
  });

  test("reads the stream with fetch and the bearer token when the host is paired by token", async () => {
    const host = liveResponse();
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) => host.response,
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setManagedHostConfig({ baseUrl: "https://mac.tail1234.ts.net", token: "aop_t" });

    openHostEventSource("https://mac.tail1234.ts.net/api/projects/p/stream", true);
    await settle();

    expect(nativeSources).toHaveLength(0);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://mac.tail1234.ts.net/api/projects/p/stream");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer aop_t" });
  });
});
