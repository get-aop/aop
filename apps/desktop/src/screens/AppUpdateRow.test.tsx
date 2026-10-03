import { beforeEach, describe, expect, test } from "bun:test";
import type { AppUpdateState } from "@aop/common";
import { setupDesktopDom } from "../test/setup-dom";
import { HOST, remote, showApp } from "../test/show-app";

setupDesktopDom();

const { cleanup, fireEvent, waitFor } = await import("@testing-library/react");

beforeEach(() => {
  cleanup();
  window.location.hash = "";
});

const NOTES = "https://getaop.com/releases/v0.10.0.md";

const showRow = async (update: AppUpdateState) => {
  const shown = await showApp(
    remote({ status: "connected", host: HOST, hostVersion: "0.9.51" }),
    update,
  );
  await waitFor(() => expect(shown.view.getByTestId("app-update")).toBeDefined());
  const text = (testId: string) => shown.view.queryByTestId(testId)?.textContent ?? null;
  return { ...shown, text };
};

describe("This app's row", () => {
  test("names the app, its platform and version, and what it would update to", async () => {
    const { text, view } = await showRow({
      status: "available",
      version: "0.10.0",
      releaseUrl: NOTES,
      mode: "auto",
    });

    expect(text("app-update-versions")).toBe("AOP for macOS · 0.9.51 → 0.10.0 · Release notes");
    expect(view.getByTestId("app-update-notes").getAttribute("href")).toBe(NOTES);
    expect(view.getByTestId("app-update-notes").getAttribute("target")).toBe("_blank");
  });

  test.each<[AppUpdateState, string, string | null]>([
    [{ status: "off" }, "This build does not update itself.", null],
    [{ status: "idle", checkedAt: null }, "Up to date", "Check for updates"],
    [{ status: "checking" }, "Checking for updates…", null],
    [
      { status: "available", version: "0.10.0", releaseUrl: null, mode: "auto" },
      "Update available",
      "Download and restart",
    ],
    [
      { status: "available", version: "0.10.0", releaseUrl: null, mode: "notice" },
      "Update available. Download it, then quit AOP and replace the app in Applications.",
      "Download",
    ],
    [{ status: "downloading", version: "0.10.0", percent: 62 }, "Downloading… 62%", null],
    [
      { status: "ready", version: "0.10.0", releaseUrl: null },
      "Downloaded. Restarting takes a few seconds.",
      "Restart to update",
    ],
    [
      { status: "error", message: "net::ERR_CONNECTION_RESET", version: "0.10.0" },
      "Update failed: net::ERR_CONNECTION_RESET",
      "Check for updates",
    ],
  ])("%j reads %p, with one action: %p", async (update, status, action) => {
    const { text } = await showRow(update);

    expect(text("app-update-status")).toBe(status);
    expect(text("app-update-action")).toBe(action);
  });

  test("each action does what it says", async () => {
    const cases: [
      AppUpdateState,
      "checkForUpdates" | "downloadAndRestart" | "openUpdateDownload",
    ][] = [
      [{ status: "idle", checkedAt: null }, "checkForUpdates"],
      [
        { status: "available", version: "0.10.0", releaseUrl: null, mode: "auto" },
        "downloadAndRestart",
      ],
      [
        { status: "available", version: "0.10.0", releaseUrl: null, mode: "notice" },
        "openUpdateDownload",
      ],
    ];
    for (const [update, method] of cases) {
      const { view, backend } = await showRow(update);
      fireEvent.click(view.getByTestId("app-update-action"));
      expect(backend[method]).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  test("a failure is announced, and keeps the version it was after", async () => {
    const { text, view } = await showRow({
      status: "error",
      message: "The release feed answered 502.",
      version: "0.10.0",
    });

    expect(view.getByTestId("app-update-status").getAttribute("role")).toBe("alert");
    expect(text("app-update-versions")).toBe("AOP for macOS · 0.9.51 → 0.10.0");
  });
});
