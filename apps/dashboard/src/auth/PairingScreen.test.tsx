import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { CHANNELS } = await import("@aop/common");
const { cleanup, render, screen } = await import("@testing-library/react");
const { PairingScreen } = await import("./PairingScreen");

afterEach(cleanup);

const renderScreen = (props: Partial<Parameters<typeof PairingScreen>[0]>) => {
  render(<PairingScreen onPaired={() => {}} {...props} />);
  return {
    command: screen.getByTestId("pairing-command").textContent,
    hint: screen.getByTestId("pairing-port-hint").textContent,
  };
};

describe("PairingScreen", () => {
  test("a stable host behind a proxy shows stable's port", () => {
    const { command, hint } = renderScreen({
      channel: CHANNELS.stable,
      apiOrigin: "https://mac.tail1234.ts.net",
    });
    expect(command).toBe("curl -s -X POST http://127.0.0.1:25150/api/auth/pairing-codes");
    expect(hint).toContain("AOP's default is 25150");
  });

  test("an AOP Nightly host behind a proxy shows Nightly's port", () => {
    const { command, hint } = renderScreen({
      channel: CHANNELS.nightly,
      apiOrigin: "https://mac.tail1234.ts.net",
    });
    expect(command).toBe("curl -s -X POST http://127.0.0.1:25650/api/auth/pairing-codes");
    expect(hint).toContain("AOP Nightly's default is 25650");
    expect(hint).not.toContain("25150");
  });

  test("a page served from a custom port asks the host on that port", () => {
    const { command, hint } = renderScreen({
      channel: CHANNELS.stable,
      apiOrigin: "http://aop.localhost:25999",
    });
    expect(command).toBe("curl -s -X POST http://127.0.0.1:25999/api/auth/pairing-codes");
    expect(hint).toContain("AOP's default is 25150");
  });
});
