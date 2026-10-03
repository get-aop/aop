import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { CHANNELS } = await import("@aop/common");
const { cleanup, render, screen } = await import("@testing-library/react");
const { PairingScreen } = await import("./PairingScreen");

afterEach(() => cleanup());

const helpFor = (channel: (typeof CHANNELS)[keyof typeof CHANNELS]) => {
  render(<PairingScreen onPaired={() => {}} channel={channel} />);
  return screen.getByTestId("pairing-help").textContent ?? "";
};

describe("PairingScreen", () => {
  test("points to the host's settings and to aop pair, never to a loopback curl", () => {
    const help = helpFor(CHANNELS.stable);

    expect(help).toStartWith(
      "Get a code on the host: AOP settings › Host › Pair a device, or run aop pair there. Any device already paired can also make one.",
    );
    expect(screen.getByTestId("pairing-screen").textContent).not.toContain("curl");
    expect(screen.getByTestId("pairing-screen").textContent).not.toContain("127.0.0.1");
  });

  test("names AOP Nightly's own command on a Nightly host", () => {
    expect(helpFor(CHANNELS.nightly)).toContain("run aop-nightly pair there");
  });
});
