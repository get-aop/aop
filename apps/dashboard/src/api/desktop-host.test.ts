import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { getHostConfig, setManagedHostConfig } = await import("./host");
const { bootstrapDesktopHost } = await import("./desktop-host");
const { request } = await import("./request");

const originalFetch = globalThis.fetch;

const answering = (status: number, body: unknown) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch;

afterEach(() => {
  setManagedHostConfig(null);
  globalThis.fetch = originalFetch;
});

describe("bootstrapDesktopHost", () => {
  test("takes the host and token the desktop app decided on, in memory", async () => {
    await bootstrapDesktopHost({
      getHostConfig: async () => ({ baseUrl: "https://mac.tail1234.ts.net", token: "aop_t" }),
      hostRejected: async () => {},
    });

    expect(getHostConfig()).toEqual({ baseUrl: "https://mac.tail1234.ts.net", token: "aop_t" });
    expect(window.localStorage.length).toBe(0);
  });

  test("does nothing outside the desktop app, where there is no bridge", async () => {
    await bootstrapDesktopHost(undefined);
    await bootstrapDesktopHost({ hostRejected: async () => {} });

    expect(getHostConfig()).toEqual({ baseUrl: null, token: null });
  });

  test("tells the app when the host refuses the token, so the app can pair again", async () => {
    const hostRejected = mock(async () => {});
    await bootstrapDesktopHost({
      getHostConfig: async () => ({ baseUrl: "https://mac.tail1234.ts.net", token: "aop_old" }),
      hostRejected,
    });
    globalThis.fetch = answering(401, {
      error: "Authentication required",
      code: "UNAUTHENTICATED",
    });

    await request("/projects").catch(() => undefined);

    expect(hostRejected).toHaveBeenCalled();
  });

  test("keeps the dashboard on its own origin when the app cannot say which host to use", async () => {
    await bootstrapDesktopHost({
      getHostConfig: async () => {
        throw new Error("Blocked desktop IPC sender.");
      },
      hostRejected: async () => {},
    });

    expect(getHostConfig()).toEqual({ baseUrl: null, token: null });
  });
});
