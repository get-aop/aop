import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installFakeCliHost, makeCli } from "../agent-clis/test-utils";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { SidebarFooterStatus } = await import("./sidebar-footer");
const { resetAgentClisForTests } = await import("../agent-clis/agent-cli-store");
const { closeSettingsDialog, getDialogs } = await import("./dialog-store");

const originalFetch = globalThis.fetch;

beforeEach(() => resetAgentClisForTests(10));

afterEach(() => {
  cleanup();
  closeSettingsDialog();
  resetAgentClisForTests();
  globalThis.fetch = originalFetch;
});

describe("SidebarFooterStatus agent CLI notice", () => {
  test("names the CLI and the version out, and opens the Runtimes panel", async () => {
    installFakeCliHost();
    render(<SidebarFooterStatus connection="connected" />);

    await waitFor(() =>
      expect(screen.getByTestId("sidebar-cli-update").textContent).toBe(
        "Claude Code 2.1.286 available",
      ),
    );
    fireEvent.click(screen.getByTestId("sidebar-cli-update"));
    expect(getDialogs().settings).toEqual({ open: true, section: "runtimes" });
  });

  test("is absent when every CLI is up to date, or while its update runs", async () => {
    for (const cli of [
      makeCli({ updateAvailable: false }),
      makeCli({ update: { ...makeCli().update, state: "updating" } }),
    ]) {
      const host = installFakeCliHost({ clis: [cli] });
      const { unmount } = render(<SidebarFooterStatus connection="connected" />);
      await waitFor(() => expect(host.calls).toContain("GET /agent-clis"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByTestId("sidebar-cli-update")).toBeNull();
      unmount();
      resetAgentClisForTests(10);
    }
  });
});
