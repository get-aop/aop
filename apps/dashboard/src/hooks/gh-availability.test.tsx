import { afterEach, describe, expect, mock, test } from "bun:test";
import type { FactoryHealthSeverity, FactoryHealthSnapshot } from "@aop/common";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const mockGetFactoryHealth = mock();
const actualClientModule = await import("../api/client");
mock.module("../api/client", () => ({
  ...actualClientModule,
  getFactoryHealth: mockGetFactoryHealth,
}));

const { render, screen, cleanup, waitFor } = await import("@testing-library/react");
const { GhAvailabilityProvider, useGhAvailability } = await import("./gh-availability");

afterEach(() => {
  cleanup();
  mockGetFactoryHealth.mockReset();
});

const Probe = () => (
  <span data-testid="probe">{useGhAvailability() ? "available" : "unavailable"}</span>
);

const snapshotWithGhCli = (severity: FactoryHealthSeverity): FactoryHealthSnapshot => ({
  generatedAt: "2026-06-16T00:00:00.000Z",
  severity,
  summary: { ok: 0, warning: 0, error: 0 },
  services: [],
  integrations: [{ id: "github-cli", label: "GitHub CLI", severity, message: "x" }],
  recentFailures: [],
});

describe("GhAvailabilityProvider", () => {
  test("reports unavailable when the github-cli health item is an error", async () => {
    mockGetFactoryHealth.mockResolvedValue(snapshotWithGhCli("error"));

    render(
      <GhAvailabilityProvider>
        <Probe />
      </GhAvailabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("unavailable"));
  });

  test("reports available when the github-cli health item is ok", async () => {
    mockGetFactoryHealth.mockResolvedValue(snapshotWithGhCli("ok"));

    render(
      <GhAvailabilityProvider>
        <Probe />
      </GhAvailabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("available"));
  });

  test("defaults to available when the health fetch fails", async () => {
    mockGetFactoryHealth.mockRejectedValue(new Error("boom"));

    render(
      <GhAvailabilityProvider>
        <Probe />
      </GhAvailabilityProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("probe")).toBeDefined());
    expect(screen.getByTestId("probe").textContent).toBe("available");
  });
});
