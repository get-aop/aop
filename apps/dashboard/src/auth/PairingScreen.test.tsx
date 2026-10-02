import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { CHANNELS } = await import("@aop/common");
const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { PairingScreen } = await import("./PairingScreen");

const originalFetch = globalThis.fetch;
const PROXIED = "https://mac.tail1234.ts.net";
let health: () => Response;
let healthCalls = 0;

beforeEach(() => {
  healthCalls = 0;
  // An older host's health, which names no port.
  health = () => Response.json({ service: "aop", version: "0.10.0" });
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    if (String(input) === "/api/health") healthCalls += 1;
    return health();
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const renderScreen = async (props: Partial<Parameters<typeof PairingScreen>[0]>) => {
  render(<PairingScreen onPaired={() => {}} {...props} />);
  await waitFor(() => expect(healthCalls).toBe(1));
  return {
    command: () => screen.getByTestId("pairing-command").textContent,
    hint: screen.getByTestId("pairing-port-hint").textContent,
  };
};

describe("PairingScreen", () => {
  test("a stable host behind a proxy shows stable's port", async () => {
    const { command, hint } = await renderScreen({ channel: CHANNELS.stable, apiOrigin: PROXIED });
    expect(command()).toBe("curl -s -X POST http://127.0.0.1:25150/api/auth/pairing-codes");
    expect(hint).toContain("AOP's default is 25150");
  });

  test("an AOP Nightly host behind a proxy shows Nightly's port", async () => {
    const { command, hint } = await renderScreen({ channel: CHANNELS.nightly, apiOrigin: PROXIED });
    expect(command()).toBe("curl -s -X POST http://127.0.0.1:25650/api/auth/pairing-codes");
    expect(hint).toContain("AOP Nightly's default is 25650");
    expect(hint).not.toContain("25150");
  });

  test("a page served from a custom port asks the host on that port", async () => {
    const { command, hint } = await renderScreen({
      channel: CHANNELS.stable,
      apiOrigin: "http://aop.localhost:25999",
    });
    expect(command()).toBe("curl -s -X POST http://127.0.0.1:25999/api/auth/pairing-codes");
    expect(hint).toContain("AOP's default is 25150");
  });

  test("the port the host reports wins, even behind a proxy on another port", async () => {
    health = () => Response.json({ service: "aop", version: "0.10.8", port: 25777 });
    const { command } = await renderScreen({
      channel: CHANNELS.stable,
      apiOrigin: "https://mac.tail1234.ts.net:8443",
    });
    await waitFor(() =>
      expect(command()).toBe("curl -s -X POST http://127.0.0.1:25777/api/auth/pairing-codes"),
    );
  });

  test("a host that does not answer leaves the fallback in place", async () => {
    health = () => Response.json({ error: "down" }, { status: 503 });
    const { command } = await renderScreen({ channel: CHANNELS.nightly, apiOrigin: PROXIED });
    expect(command()).toBe("curl -s -X POST http://127.0.0.1:25650/api/auth/pairing-codes");
  });
});
