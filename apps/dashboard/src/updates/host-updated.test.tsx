import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { Toaster } = await import("@/ui/sonner");
const { rememberHostUpdated, useHostUpdatedToast } = await import("./host-updated");

const Shell = () => {
  useHostUpdatedToast();
  return <Toaster />;
};

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("the host-updated toast", () => {
  test("a page reloaded after the host came back says so once", async () => {
    const before = render(<Shell />);
    rememberHostUpdated(
      { version: "0.20.1", hostName: "soulf", releaseUrl: null },
      { reloading: true },
    );
    // The page about to reload shows nothing yet, so the note survives the reload.
    expect(screen.queryByText("Host soulf updated to 0.20.1")).toBeNull();
    before.unmount();

    render(<Shell />);

    expect(await screen.findByText("Host soulf updated to 0.20.1")).toBeTruthy();
    expect(window.sessionStorage.getItem("aop:host-updated:v1")).toBeNull();
  });

  test("the desktop app, which does not reload, hears it at once", async () => {
    render(<Shell />);

    rememberHostUpdated(
      { version: "0.20.2", hostName: "soulf", releaseUrl: null },
      { reloading: false },
    );

    expect(await screen.findByText("Host soulf updated to 0.20.2")).toBeTruthy();
  });
});
