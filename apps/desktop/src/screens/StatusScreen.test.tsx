import { beforeEach, describe, expect, test } from "bun:test";
import { setupDesktopDom } from "../test/setup-dom";
import { HOST, remote, showApp } from "../test/show-app";

setupDesktopDom();

const { act, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

beforeEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("a remote host", () => {
  test("connected: names the host and its version, and shows the dashboard", async () => {
    const { view, backend } = await showApp(
      remote({ status: "connected", host: HOST, hostVersion: "0.9.51" }),
    );

    expect(view.getByText("Host mac")).toBeDefined();
    expect(view.getByTestId("status-label").textContent).toBe("Connected to mac.tail1234.ts.net");
    expect(view.getByTestId("status-label").getAttribute("data-tone")).toBe("ok");
    expect(view.getByTestId("status-host-version").textContent).toBe("0.9.51");
    fireEvent.click(view.getByTestId("status-open-dashboard"));
    expect(backend.openDashboard).toHaveBeenCalledTimes(1);
  });

  test("unreachable: says why, offers to check again, and has no dashboard to show", async () => {
    const { view, backend } = await showApp(
      remote({ status: "unreachable", host: HOST, message: "The host refused the connection." }),
    );

    expect(view.getByTestId("status-explanation").textContent).toContain(
      "The host refused the connection.",
    );
    expect(view.queryByTestId("status-open-dashboard")).toBeNull();
    fireEvent.click(view.getByTestId("status-retry"));
    expect(backend.reconnect).toHaveBeenCalledTimes(1);
  });

  test("refused token: offers to pair again, on the connect screen", async () => {
    const { view } = await showApp(remote({ status: "unauthorized", host: HOST }));

    expect(view.getByTestId("status-explanation").textContent).toContain(
      "does not know this device",
    );
    expect(view.queryByTestId("status-retry")).toBeNull();
    fireEvent.click(view.getByTestId("status-pair-again"));
    expect(window.location.hash).toBe("#/connect");
  });

  test.each([
    ["client-too-old", "Update the app"],
    ["host-too-old", "Update AOP on the host"],
    ["not-aop", "not as an AOP host"],
  ] as const)("incompatible (%s): says which side to update", async (reason, expected) => {
    const { view } = await showApp(
      remote({ status: "incompatible", host: HOST, reason, hostVersion: "9" }),
    );

    expect(view.getByTestId("status-explanation").textContent).toContain(expected);
  });

  test("Change host goes to the connect screen, and Back returns", async () => {
    const { view } = await showApp(remote({ status: "connected", host: HOST, hostVersion: "1" }));

    fireEvent.click(view.getByTestId("status-change-host"));
    await waitFor(() => expect(view.getByTestId("connect-screen")).toBeDefined());

    fireEvent.click(view.getByTestId("connect-back"));
    await waitFor(() => expect(view.getByTestId("status-screen")).toBeDefined());
  });

  test("Disconnect asks first, and only the confirmation forgets the host", async () => {
    const { view, backend } = await showApp(
      remote({ status: "connected", host: HOST, hostVersion: "1" }),
    );

    fireEvent.click(view.getByTestId("status-disconnect"));
    expect(backend.forgetHost).not.toHaveBeenCalled();
    expect(view.getByTestId("status-disconnect-confirm").textContent).toContain(
      "Disconnect from mac?",
    );

    fireEvent.click(view.getByTestId("status-disconnect-cancel"));
    expect(view.queryByTestId("status-disconnect-confirm")).toBeNull();
    expect(backend.forgetHost).not.toHaveBeenCalled();

    fireEvent.click(view.getByTestId("status-disconnect"));
    fireEvent.click(view.getByTestId("status-disconnect-confirm-button"));
    expect(backend.forgetHost).toHaveBeenCalledTimes(1);
  });

  test("says when the host is older than the app, and stays quiet when it is not", async () => {
    const older = await showApp(remote({ status: "connected", host: HOST, hostVersion: "0.9.0" }));
    expect(older.view.getByTestId("status-host-drift").textContent).toContain(
      "Older than this app",
    );
    cleanup();

    const same = await showApp(remote({ status: "connected", host: HOST, hostVersion: "0.9.51" }));
    expect(same.view.queryByTestId("status-host-drift")).toBeNull();
    expect(same.view.queryByTestId("app-update-drift")).toBeNull();
  });

  test("a newer host is said on This app's row, naming the host", async () => {
    const { view } = await showApp(
      remote({ status: "connected", host: HOST, hostVersion: "0.10.0+abc1234" }),
    );

    await waitFor(() =>
      expect(view.getByTestId("app-update-drift").textContent).toBe(
        "mac runs 0.10.0; this app is older",
      ),
    );
  });

  test("follows This app's update as the app pushes it, down to the restart", async () => {
    const { view, backend, pushUpdate } = await showApp(
      remote({ status: "connected", host: HOST, hostVersion: "0.9.51" }),
    );
    await waitFor(() =>
      expect(view.getByTestId("app-update-status").textContent).toBe("Up to date"),
    );

    act(() => pushUpdate({ status: "downloading", version: "0.10.0", percent: 62 }));
    await waitFor(() =>
      expect(view.getByTestId("app-update-status").textContent).toBe("Downloading… 62%"),
    );
    expect(view.queryByTestId("app-update-action")).toBeNull();

    act(() => pushUpdate({ status: "ready", version: "0.10.0", releaseUrl: null }));
    await waitFor(() =>
      expect(view.getByTestId("app-update-action").textContent).toBe("Restart to update"),
    );
    fireEvent.click(view.getByTestId("app-update-action"));
    expect(backend.restartToUpdate).toHaveBeenCalledTimes(1);
  });

  test("follows what the app pushes: connecting, then connected", async () => {
    const { view, push } = await showApp(remote({ status: "connecting", host: HOST }));
    expect(view.getByTestId("status-label").getAttribute("data-tone")).toBe("busy");

    act(() => push(remote({ status: "connected", host: HOST, hostVersion: "1" })));

    await waitFor(() =>
      expect(view.getByTestId("status-label").getAttribute("data-tone")).toBe("ok"),
    );
  });
});
