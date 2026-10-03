import { afterEach, describe, expect, mock, test } from "bun:test";

process.env.AOP_LOCAL_SERVER_PORT ??= "4111";
process.env.AOP_LOCAL_SERVER_URL ??= "http://127.0.0.1:4111";

const clientModulePath = "./client.ts?client-test";
const clientModule = await import(clientModulePath);
const { fetchServer, getServerUrl } = clientModule as typeof import("./client.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getServerUrl", () => {
  test("returns local server URL from config", () => {
    const serverUrl = getServerUrl();
    expect(typeof serverUrl).toBe("string");
    expect(serverUrl.length).toBeGreaterThan(0);
  });

  test("falls back to the source install local server URL when env is unset", () => {
    const originalServerUrl = process.env.AOP_LOCAL_SERVER_URL;
    delete process.env.AOP_LOCAL_SERVER_URL;

    expect(getServerUrl()).toBe("http://127.0.0.1:25150");

    if (originalServerUrl === undefined) {
      delete process.env.AOP_LOCAL_SERVER_URL;
      return;
    }

    process.env.AOP_LOCAL_SERVER_URL = originalServerUrl;
  });
});

describe("fetchServer", () => {
  test("returns ok=true and parsed data for successful responses", async () => {
    const body = { status: "ok", value: 42 };
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => body,
    })) as unknown as typeof fetch;

    const result = await fetchServer<{ status: string; value: number }>("/api/status", {
      method: "GET",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(`${getServerUrl()}/api/status`, {
      method: "GET",
    });
    expect(result).toEqual({ ok: true, data: body });
  });

  test("returns ok=false with status and error payload for failed responses", async () => {
    const errorBody = { error: "bad request", detail: "invalid input" };
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 400,
      json: async () => errorBody,
    })) as unknown as typeof fetch;

    const result = await fetchServer<{ status: string }>("/api/settings/unknown_key", {
      method: "POST",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: errorBody,
    });
  });
});

describe("asAgentWhenInTurn", () => {
  const { asAgentWhenInTurn } = clientModule as typeof import("./client.ts");

  test("marks a request made inside an agent's turn, keeping its other headers", () => {
    const options = asAgentWhenInTurn(
      { method: "PUT", headers: { "Content-Type": "application/json" } },
      { AOP_CHAT_SESSION_ID: "session-1" },
    );

    const headers = new Headers(options?.headers);
    expect(options?.method).toBe("PUT");
    expect(headers.get("x-aop-agent-session")).toBe("session-1");
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("leaves a person's request as it is", () => {
    const options = { method: "GET" };
    expect(asAgentWhenInTurn(options, {})).toBe(options);
  });
});
