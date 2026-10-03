import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeHost, makeUpdateStatus } from "../updates/test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { resetUpdatesForTests } = await import("../updates/update-store");
const { getDialogs, resetDialogs } = await import("../shell/dialog-store");
const { SettingsAbout } = await import("./settings-about");

const originalFetch = globalThis.fetch;

beforeEach(() => resetUpdatesForTests());

afterEach(() => {
  cleanup();
  resetUpdatesForTests();
  resetDialogs();
  globalThis.fetch = originalFetch;
});

describe("SettingsAbout", () => {
  test("lists the versions only, and sends updates to AOP settings › Updates", async () => {
    installFakeHost({ status: makeUpdateStatus({ current: "0.10.7" }) });
    render(<SettingsAbout />);

    await waitFor(() =>
      expect(screen.getByTestId("about-host-version").textContent).toBe("0.10.7"),
    );
    expect(screen.getByText("Host soulf")).toBeTruthy();
    expect(screen.getByTestId("about-api-version").textContent).toBe("1");
    expect(screen.queryByTestId("update-action-update-host")).toBeNull();

    fireEvent.click(screen.getByTestId("about-updates-link"));
    expect(getDialogs().settings).toEqual({ open: true, section: "updates" });
  });
});
