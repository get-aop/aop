import type { EventLogEntry, Project, Thread } from "@aop/common";
import type { FetchLike } from "../connection/host-client";

export interface OpenStream {
  projectId: string;
  url: string;
  headers: Record<string, string>;
  /** Sends one entry as the host would. */
  entry: (entry: EventLogEntry) => void;
  resync: (cursor: number) => void;
  /** Sends bytes as they are, for a frame the client should not be able to read. */
  raw: (text: string) => void;
  /** The host closes the stream. */
  end: () => void;
  /** True once the client hung up. */
  aborted: () => boolean;
}

/** A host the watcher can read: projects, threads, and streams a test writes to by hand. */
export const createFakeHost = () => {
  const host = {
    projects: [] as Project[],
    threads: {} as Record<string, Thread[]>,
    token: "aop_t" as string | null,
    streams: [] as OpenStream[],
    requests: [] as string[],
    /** Status to answer a stream with instead of opening it. */
    streamStatus: {} as Record<string, number>,
    listStatus: 200,
  };

  const encoder = new TextEncoder();

  const listProjects = (): Response =>
    host.listStatus === 200
      ? Response.json({ projects: host.projects })
      : new Response(null, { status: host.listStatus });

  const route = (
    url: URL,
    headers: Record<string, string>,
    signal: AbortSignal | null | undefined,
  ): Response => {
    if (url.pathname === "/api/projects") return listProjects();
    const threads = /^\/api\/projects\/([^/]+)\/threads$/.exec(url.pathname);
    if (threads?.[1]) return Response.json({ threads: host.threads[threads[1]] ?? [] });
    const stream = /^\/api\/projects\/([^/]+)\/stream$/.exec(url.pathname);
    if (stream?.[1]) return openStream(stream[1], url, headers, signal);
    return new Response(null, { status: 404 });
  };

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    host.requests.push(`${url.pathname}${url.search}`);
    if (host.token !== null && headers.authorization !== `Bearer ${host.token}`) {
      return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    }
    return route(url, headers, init?.signal);
  };

  const openStream = (
    projectId: string,
    url: URL,
    headers: Record<string, string>,
    signal: AbortSignal | null | undefined,
  ): Response => {
    const status = host.streamStatus[projectId];
    if (status) return new Response(null, { status });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const write = (text: string) => controller.enqueue(encoder.encode(text));
    let hungUp = false;
    signal?.addEventListener("abort", () => {
      hungUp = true;
      try {
        controller.error(new DOMException("aborted", "AbortError"));
      } catch {
        // Already closed by the host.
      }
    });
    host.streams.push({
      projectId,
      url: `${url.pathname}${url.search}`,
      headers,
      entry: (entry) => write(`id: ${entry.id}\nevent: entry\ndata: ${JSON.stringify(entry)}\n\n`),
      resync: (cursor) =>
        write(`event: resync\ndata: ${JSON.stringify({ cursor, reason: "start" })}\n\n`),
      raw: write,
      end: () => controller.close(),
      aborted: () => hungUp,
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };

  return {
    host,
    fetch,
    streamFor: (projectId: string) => host.streams.filter((s) => s.projectId === projectId),
  };
};
