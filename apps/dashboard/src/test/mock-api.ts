import { mock } from "bun:test";

export interface ApiCall {
  method: string;
  /** The path after `/api`, with its query string. */
  path: string;
  body: unknown;
}

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
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
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
