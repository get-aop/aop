import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AuthGate } = await import("./AuthGate");
const { getHostConfig, setHostConfig } = await import("../api/host");

const originalFetch = globalThis.fetch;
const UNAUTHENTICATED = () =>
  Response.json({ error: "Authentication required", code: "UNAUTHENTICATED" }, { status: 401 });

let calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
let route: (
  method: string,
  url: string,
  body?: Record<string, unknown>,
) => Response | Promise<Response>;

beforeEach(() => {
  window.localStorage.clear();
  calls = [];
  route = () => Response.json({ kind: "owner" });
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const call = {
      method: init?.method ?? "GET",
      url: String(input),
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
    };
    calls.push(call);
    return route(call.method, call.url, call.body);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const renderGate = () =>
  render(
    <AuthGate>
      <p data-testid="app">the app</p>
    </AuthGate>,
  );

describe("AuthGate", () => {
  test("the host owner's own dashboard goes straight to the app, with no pairing", async () => {
    renderGate();

    expect(await screen.findByTestId("app")).toBeTruthy();
    expect(screen.queryByTestId("pairing-screen")).toBeNull();
    expect(calls.map((call) => call.url)).toEqual(["/api/auth/me"]);
  });

  test("a device the host does not know sees the pairing screen and none of the app", async () => {
    route = UNAUTHENTICATED;
    renderGate();

    expect(await screen.findByTestId("pairing-screen")).toBeTruthy();
    expect(screen.queryByTestId("app")).toBeNull();
  });

  test("pairing trades the code for a device, then lets the app in", async () => {
    let paired = false;
    route = (_method, url, body) => {
      if (url === "/api/auth/pair") {
        paired = true;
        return Response.json(
          {
            device: { id: "dev_1", name: body?.name, createdAt: "x", lastSeenAt: null },
            token: "aop_secret",
          },
          { status: 201 },
        );
      }
      return paired ? Response.json({ kind: "device", device: {} }) : UNAUTHENTICATED();
    };
    renderGate();

    fireEvent.change(await screen.findByTestId("pairing-code-input"), {
      target: { value: "k7qm-4xnp" },
    });
    fireEvent.change(screen.getByTestId("pairing-device-name"), {
      target: { value: "Work laptop" },
    });
    fireEvent.click(screen.getByTestId("pairing-submit"));

    expect(await screen.findByTestId("app")).toBeTruthy();
    const pair = calls.find((call) => call.url === "/api/auth/pair");
    expect(pair?.method).toBe("POST");
    expect(pair?.body).toEqual({ code: "K7QM-4XNP", name: "Work laptop" });
    // The cookie the host set authenticates a same-origin page: no token is kept in script-readable storage.
    expect(getHostConfig().token).toBeNull();
  });

  test("a wrong code is explained and the screen stays for another try", async () => {
    route = (_method, url) =>
      url === "/api/auth/pair"
        ? Response.json(
            { error: "Wrong or expired pairing code", code: "INVALID_PAIRING_CODE" },
            { status: 401 },
          )
        : UNAUTHENTICATED();
    renderGate();

    fireEvent.change(await screen.findByTestId("pairing-code-input"), {
      target: { value: "WRONG" },
    });
    fireEvent.click(screen.getByTestId("pairing-submit"));

    expect((await screen.findByTestId("pairing-error")).textContent).toBe(
      "Wrong or expired pairing code",
    );
    expect(screen.getByTestId("pairing-screen")).toBeTruthy();
    expect((screen.getByTestId("pairing-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  test("pairing needs a code", async () => {
    route = UNAUTHENTICATED;
    renderGate();

    expect(((await screen.findByTestId("pairing-submit")) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId("pairing-device-name") as HTMLInputElement).value).toMatch(/ on /);
  });

  test("a host on another origin gets the device token kept for bearer requests", async () => {
    setHostConfig({ baseUrl: "https://mac.example", token: null });
    let paired = false;
    route = (_method, url) => {
      if (url.endsWith("/api/auth/pair")) {
        paired = true;
        return Response.json({ device: {}, token: "aop_remote" }, { status: 201 });
      }
      return paired ? Response.json({ kind: "device", device: {} }) : UNAUTHENTICATED();
    };
    renderGate();

    fireEvent.change(await screen.findByTestId("pairing-code-input"), {
      target: { value: "ABCD-EFGH" },
    });
    fireEvent.click(screen.getByTestId("pairing-submit"));

    await screen.findByTestId("app");
    expect(getHostConfig()).toEqual({ baseUrl: "https://mac.example", token: "aop_remote" });
    expect(calls.at(-1)?.url).toBe("https://mac.example/api/auth/me");
  });

  test("an unreachable host is not mistaken for an unpaired device, and can be retried", async () => {
    route = () => {
      throw new Error("Failed to fetch");
    };
    renderGate();

    expect((await screen.findByTestId("host-unreachable")).textContent).toContain(
      "Failed to fetch",
    );
    expect(screen.queryByTestId("pairing-screen")).toBeNull();

    route = () => Response.json({ kind: "owner" });
    fireEvent.click(screen.getByTestId("host-retry"));
    expect(await screen.findByTestId("app")).toBeTruthy();
  });

  test("a device that is revoked while the app is open is sent back to pairing", async () => {
    renderGate();
    await screen.findByTestId("app");

    route = UNAUTHENTICATED;
    const { request } = await import("../api/request");
    await act(async () => {
      await request("/projects").catch(() => {});
    });

    await waitFor(() => expect(screen.getByTestId("pairing-screen")).toBeTruthy());
    expect(screen.queryByTestId("app")).toBeNull();
  });
});
