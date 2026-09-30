import { mock } from "bun:test";

export interface RecordedRequest {
  method: string;
  /** The path and query as the page asked for them, e.g. `/api/threads/thr_1/reply`. */
  url: string;
  body: unknown;
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** What the host answers when it refuses: the body every `errorResponse` sends. */
export const hostError = (status: number, code: string, error: string): Response =>
  json({ error, code }, status);

/**
 * Stands in for the host: every request the page makes is recorded, and `respond` (replaceable
 * per test) decides the answer. Call `restore` in `afterEach`.
 */
export const mockHost = () => {
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  const handler: { respond: (request: RecordedRequest) => Response | Promise<Response> } = {
    respond: () => json({}),
  };
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const recorded: RecordedRequest = {
      method: init?.method ?? "GET",
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(recorded);
    return handler.respond(recorded);
  }) as unknown as typeof fetch;
  return {
    requests,
    /** Answers every request with `respond` from now on. */
    respondWith: (respond: typeof handler.respond) => {
      handler.respond = respond;
    },
    /** The requests made so far to a path (a suffix of the URL, query included), oldest first. */
    to: (path: string, method?: string) =>
      requests.filter(
        (request) =>
          request.url.endsWith(path) && (method === undefined || request.method === method),
      ),
    restore: () => {
      globalThis.fetch = original;
    },
  };
};
