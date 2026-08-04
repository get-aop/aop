import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const mockGetUpdateStatus = mock();
const mockInstallUpdate = mock();
const actualClientModule = await import("../api/client.ts");

mock.module("../api/client", () => ({
  ...actualClientModule,
  getUpdateStatus: mockGetUpdateStatus,
  installUpdate: mockInstallUpdate,
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { DashboardVersion } = await import("./DashboardVersion");

beforeEach(() => {
  mockGetUpdateStatus.mockReset();
  mockInstallUpdate.mockReset();
});

afterEach(cleanup);

describe("DashboardVersion", () => {
  test("shows the current version (no update button) when up to date", async () => {
    mockGetUpdateStatus.mockResolvedValue({
      currentVersion: "0.2.1+abc1234",
      latestVersion: "0.2.1",
      updateAvailable: false,
      canAutoUpdate: true,
    });

    render(<DashboardVersion />);

    await waitFor(() => expect(screen.getByText("v0.2.1")).toBeDefined());
    expect(screen.queryByRole("button", { name: /Update available/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Check for updates/i })).toBeDefined();
  });

  test("marks source/dev builds and hides the check button when auto-update is unavailable", async () => {
    mockGetUpdateStatus.mockResolvedValue({
      currentVersion: "0.2.1+dev",
      latestVersion: null,
      updateAvailable: false,
      canAutoUpdate: false,
    });

    render(<DashboardVersion />);

    await waitFor(() => expect(screen.getByText("v0.2.1 (dev)")).toBeDefined());
    expect(screen.queryByRole("button", { name: /Check for updates/i })).toBeNull();
  });

  test("re-checks for updates on demand", async () => {
    mockGetUpdateStatus.mockResolvedValue({
      currentVersion: "0.2.1+abc1234",
      latestVersion: "0.2.1",
      updateAvailable: false,
      canAutoUpdate: true,
    });

    render(<DashboardVersion />);

    await waitFor(() => expect(mockGetUpdateStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Check for updates/i }));
    await waitFor(() => expect(mockGetUpdateStatus).toHaveBeenCalledTimes(2));
  });

  test("shows the update button and starts install on click", async () => {
    mockGetUpdateStatus.mockResolvedValue({
      currentVersion: "0.1.0+abc1234",
      latestVersion: "0.2.1",
      updateAvailable: true,
      canAutoUpdate: true,
    });
    mockInstallUpdate.mockResolvedValue({
      status: "started",
      targetVersion: "0.2.1",
      message: "Upgrading to AOP 0.2.1. The server will restart shortly.",
    });

    render(<DashboardVersion />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Update available/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Update available/i }));

    await waitFor(() => expect(mockInstallUpdate).toHaveBeenCalled());
    expect(screen.getByText(/reload automatically/i)).toBeDefined();
  });
});
