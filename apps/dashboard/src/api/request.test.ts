import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { setHostConfig } = await import("./host");
const { ApiError, isUnauthenticated, onUnauthenticated, request } = await import("./request");

const originalFetch = globalThis.fetch;
const fetchMock = mock(async (_url: string | URL | Request, _init?: RequestInit) =>
  Response.json({ ok: true }),
);

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("request", () => {
  test("calls the page's own origin with its cookie and no bearer token by default", async () => {
    await request("/projects");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/projects");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  });

  test("a configured host gets the bearer token and credentials", async () => {
    setHostConfig({ baseUrl: "https://host.example", token: "aop_t" });
    await request("/projects");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://host.example/api/projects");
    expect(init?.credentials).toBe("include");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer aop_t" });
  });

  test("a 401 UNAUTHENTICATED tells the app this device is not paired, and still throws", async () => {
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ error: "Authentication required", code: "UNAUTHENTICATED" }, { status: 401 }),
    );
    const heard = mock(() => {});
    const stop = onUnauthenticated(heard);

    const error = await request("/projects").catch((cause: unknown) => cause);
    stop();

    expect(heard).toHaveBeenCalledTimes(1);
    expect(isUnauthenticated(error)).toBe(true);
    expect((error as InstanceType<typeof ApiError>).message).toBe("Authentication required");
  });

  test("other failures, even other 401s, do not send the app to the pairing screen", async () => {
    const heard = mock(() => {});
    const stop = onUnauthenticated(heard);

    fetchMock.mockImplementationOnce(async () =>
      Response.json(
        { error: "Wrong or expired pairing code", code: "INVALID_PAIRING_CODE" },
        { status: 401 },
      ),
    );
    const wrongCode = await request("/auth/pair", { method: "POST" }).catch(
      (cause: unknown) => cause,
    );
    fetchMock.mockImplementationOnce(async () =>
      Response.json({ error: "Project not found" }, { status: 404 }),
    );
    const missing = await request("/projects/x").catch((cause: unknown) => cause);
    stop();

    expect(heard).not.toHaveBeenCalled();
    expect(isUnauthenticated(wrongCode)).toBe(false);
    expect((missing as InstanceType<typeof ApiError>).status).toBe(404);
  });

  test("a body-less success (204) resolves instead of failing to parse", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    expect(await request<unknown>("/projects/x", { method: "DELETE" })).toEqual({});
  });
});
