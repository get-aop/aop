import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const mockGetHostVersion = mock();
const actualClientModule = await import("../api/client.ts");

mock.module("../api/client", () => ({
  ...actualClientModule,
  getHostVersion: mockGetHostVersion,
}));

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { DashboardVersion } = await import("./DashboardVersion");

beforeEach(() => {
  mockGetHostVersion.mockReset();
});

afterEach(cleanup);

describe("DashboardVersion", () => {
  test("shows the release the host reports without its build metadata", async () => {
    mockGetHostVersion.mockResolvedValue("0.2.1+abc1234");

    render(<DashboardVersion />);

    await waitFor(() => expect(screen.getByText("v0.2.1")).toBeDefined());
    expect(mockGetHostVersion).toHaveBeenCalledTimes(1);
  });

  test("says so when the host runs a source build with no release version", async () => {
    mockGetHostVersion.mockResolvedValue("dev");

    render(<DashboardVersion />);

    await waitFor(() => expect(screen.getByText("dev build")).toBeDefined());
  });

  test("says the version is unavailable when the host does not answer", async () => {
    mockGetHostVersion.mockRejectedValue(new Error("offline"));

    render(<DashboardVersion />);

    await waitFor(() => expect(mockGetHostVersion).toHaveBeenCalledTimes(1));
    expect(screen.getByText("version unavailable")).toBeDefined();
  });
});
