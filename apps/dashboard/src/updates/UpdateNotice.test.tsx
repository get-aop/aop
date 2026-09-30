import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeHost, makeUpdateStatus } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { UpdateNotice } = await import("./UpdateNotice");
const { resetUpdatesForTests } = await import("./update-store");

const originalFetch = globalThis.fetch;
const originalOpen = window.open;
const reload = mock(() => {});

beforeEach(() => {
  window.localStorage.clear();
  reload.mockClear();
  resetUpdatesForTests({ reload, pollMs: 10, giveUpMs: 1_000 });
});

afterEach(() => {
  cleanup();
  resetUpdatesForTests();
  globalThis.fetch = originalFetch;
  window.open = originalOpen;
});

describe("UpdateNotice", () => {
  test("the owner sees the version, the release notes and Update now", async () => {
    installFakeHost();
    render(<UpdateNotice />);

    await waitFor(() => expect(screen.getByTestId("update-notice")).toBeTruthy());
    expect(screen.getByTestId("update-notice").textContent).toContain("Update available (0.10.0)");
    expect(screen.getByTestId("update-release-notes-link").getAttribute("href")).toBe(
      "https://github.com/get-aop/aop-mono/releases/tag/v0.10.0",
    );
    await waitFor(() => expect(screen.getByTestId("update-now-button")).toBeTruthy());
  });

  test("a paired device sees the notice but cannot start the update", async () => {
    installFakeHost({ owner: false });
    render(<UpdateNotice />);

    await waitFor(() => expect(screen.getByTestId("update-notice")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByTestId("update-now-button")).toBeNull();
  });

  test("shows nothing when up to date, switched off, or not able to update itself", async () => {
    for (const status of [
      makeUpdateStatus({ available: false, latest: "0.9.51" }),
      makeUpdateStatus({ enabled: false }),
      makeUpdateStatus({ supported: false }),
    ]) {
      const host = installFakeHost({ status });
      const { unmount } = render(<UpdateNotice />);
      await waitFor(() => expect(host.calls).toContain("GET /updates"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByTestId("update-notice")).toBeNull();
      unmount();
    }
  });

  test("Update now shows progress, then reloads when the host is back on the new release", async () => {
    const host = installFakeHost();
    render(<UpdateNotice />);
    const button = await waitFor(() => screen.getByTestId("update-now-button"));

    host.health = null;
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByTestId("update-progress").textContent).toContain(
        "Updating to 0.10.0… the page reconnects on its own",
      ),
    );
    expect(screen.queryByTestId("update-now-button")).toBeNull();
    expect(host.calls).toContain("POST /updates/apply");
    expect(reload).not.toHaveBeenCalled();

    host.health = { version: "0.10.0+abc1234" };
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  test("a refused update stays quiet, says why and offers Retry", async () => {
    installFakeHost({ applyStatus: 409 });
    render(<UpdateNotice />);

    fireEvent.click(await waitFor(() => screen.getByTestId("update-now-button")));

    await waitFor(() =>
      expect(screen.getByTestId("update-error").textContent).toBe("Nothing to update"),
    );
    expect(screen.getByTestId("update-now-button").textContent).toBe("Retry");
  });

  test("a failed update the host reports is shown with its reason", async () => {
    installFakeHost({
      status: makeUpdateStatus({ state: "failed", updateError: "Checksum mismatch" }),
    });
    render(<UpdateNotice />);

    await waitFor(() =>
      expect(screen.getByTestId("update-error").textContent).toBe("Checksum mismatch"),
    );
  });

  test("Release notes opens through the client, and Dismiss hides this release only", async () => {
    installFakeHost();
    const open = mock(() => null);
    window.open = open as unknown as typeof window.open;
    render(<UpdateNotice />);

    fireEvent.click(await waitFor(() => screen.getByTestId("update-release-notes-link")));
    expect(open).toHaveBeenCalledWith(
      "https://github.com/get-aop/aop-mono/releases/tag/v0.10.0",
      "_blank",
      "noopener,noreferrer",
    );

    fireEvent.click(screen.getByTestId("update-dismiss"));
    expect(screen.queryByTestId("update-notice")).toBeNull();
    expect(window.localStorage.getItem("aop:update-dismissed:v1")).toBe("0.10.0");
  });
});
