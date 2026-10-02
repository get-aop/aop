import { mock } from "bun:test";

export interface ApiCall {
  method: string;
  /** The path after `/api`, with its query string. */
  path: string;
  /** A JSON body parsed; any other body (an uploaded file) as sent. */
  body: unknown;
}

const sentHeaders = new WeakMap<ApiCall, Record<string, string>>();

/** The headers a recorded request was sent with (kept off the call, so calls compare as before). */
export const headersOf = (call: ApiCall | undefined): Record<string, string> =>
  (call && sentHeaders.get(call)) ?? {};

type Handler = (call: ApiCall) => Response | Promise<Response> | undefined;

/**
 * Stands in for the host. `handler` answers each request the page makes (undefined is a 404,
 * so a request nobody expected fails loudly), and `calls` records them in order.
 */
export const mockApi = (handler: Handler) => {
  const original = globalThis.fetch;
  const calls: ApiCall[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const call: ApiCall = {
      method: init?.method ?? "GET",
      path: `${url.pathname.replace(/^\/api/, "")}${url.search}`,
      body: parseBody(init?.body),
    };
    sentHeaders.set(call, { ...(init?.headers as Record<string, string> | undefined) });
    calls.push(call);
    const response = await handler(call);
    return (
      response ??
      Response.json({ error: `unexpected ${call.method} ${call.path}` }, { status: 404 })
    );
  }) as unknown as typeof fetch;
  return {
    calls,
    /** The requests that changed something, in order. */
    writes: () => calls.filter((call) => call.method !== "GET"),
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

const parseBody = (body: BodyInit | null | undefined): unknown => {
  if (!body) return undefined;
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};
