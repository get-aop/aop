import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeHost, makeUpdateStatus } from "../updates/test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { resetUpdatesForTests } = await import("../updates/update-store");
const { SettingsAbout } = await import("./settings-about");

const originalFetch = globalThis.fetch;

beforeEach(() => resetUpdatesForTests());

afterEach(() => {
  cleanup();
  resetUpdatesForTests();
  globalThis.fetch = originalFetch;
});

describe("SettingsAbout update status", () => {
  test("says the host is up to date and checks on request", async () => {
    const host = installFakeHost({
      status: makeUpdateStatus({ available: false, latest: "0.9.51" }),
    });
    render(<SettingsAbout />);

    await waitFor(() =>
      expect(screen.getByTestId("about-update-status").textContent).toBe("Up to date"),
    );
    fireEvent.click(screen.getByTestId("about-check-updates"));
    await waitFor(() => expect(host.calls).toContain("POST /updates/check"));
    expect(screen.queryByTestId("update-now-button")).toBeNull();
  });

  test("names the newer release and gives the owner Update now", async () => {
    installFakeHost();
    render(<SettingsAbout />);

    await waitFor(() =>
      expect(screen.getByTestId("about-update-status").textContent).toBe(
        "Update available (0.10.0)",
      ),
    );
    await waitFor(() => expect(screen.getByTestId("update-now-button")).toBeTruthy());
  });

  test("a paired device sees the newer release without the button", async () => {
    installFakeHost({ owner: false });
    render(<SettingsAbout />);

    await waitFor(() => expect(screen.getByTestId("about-update-status")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByTestId("update-now-button")).toBeNull();
  });

  test("shows no update row for a host that cannot update itself", async () => {
    const host = installFakeHost({ status: makeUpdateStatus({ supported: false }) });
    render(<SettingsAbout />);

    await waitFor(() => expect(host.calls).toContain("GET /updates"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("about-update-status")).toBeNull();
  });
});
