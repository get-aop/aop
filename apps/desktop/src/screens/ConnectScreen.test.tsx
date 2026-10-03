import { beforeEach, describe, expect, test } from "bun:test";
import { makeState } from "../test/fake-backend";
import { setupDesktopDom } from "../test/setup-dom";
import { HOST, remote, showApp, typeInto } from "../test/show-app";

setupDesktopDom();

const { act, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

beforeEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("Connect to a host", () => {
  test("offers this Mac and another computer, with this computer's name filled in", async () => {
    const { view } = await showApp();

    expect(view.getByText("Connect to a host")).toBeDefined();
    expect(view.getByTestId("connect-this-mac").textContent).toContain("Run AOP here.");
    expect(view.getByTestId("connect-another-computer").textContent).toContain(
      "A Mac or Linux computer that runs AOP.",
    );
    expect(view.getByTestId("connect-name").textContent).toContain("Name this computer");
    expect((view.getByTestId("connect-device-name") as HTMLInputElement).value).toBe(
      "Marcelo's MacBook",
    );
    expect((view.getByTestId("connect-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("connects with what was typed, code in capitals, and the name as edited", async () => {
    const { view, backend } = await showApp();

    await typeInto(view, "connect-url", "mac.tail1234.ts.net");
    await typeInto(view, "connect-code", "k7qm-4xnp");
    await typeInto(view, "connect-device-name", "Work laptop");
    fireEvent.submit(view.getByTestId("connect-submit").closest("form") as HTMLFormElement);

    await waitFor(() => expect(backend.connectHost).toHaveBeenCalledTimes(1));
    expect(backend.connectHost).toHaveBeenCalledWith({
      url: "mac.tail1234.ts.net",
      code: "K7QM-4XNP",
      deviceName: "Work laptop",
    });
  });

  test("says why a connection failed and lets the person try again", async () => {
    const { view, backend } = await showApp();
    backend.connectHost.mockImplementationOnce(async () => ({
      ok: false as const,
      code: "wrong-code" as const,
      message: "Wrong or expired pairing code. Ask the host for a new one.",
    }));
    await typeInto(view, "connect-url", HOST);
    await typeInto(view, "connect-code", "WRONG");

    await act(async () => {
      fireEvent.click(view.getByTestId("connect-submit"));
    });

    await waitFor(() => expect(view.getByTestId("connect-error")).toBeDefined());
    expect(view.getByTestId("connect-error").textContent).toContain(
      "Wrong or expired pairing code",
    );
    expect((view.getByTestId("connect-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  test("reports a broken connection service instead of freezing on Connecting", async () => {
    const { view, backend } = await showApp();
    backend.connectHost.mockImplementationOnce(async () => {
      throw new Error("IPC closed");
    });
    await typeInto(view, "connect-url", HOST);
    await typeInto(view, "connect-code", "K7QM-4XNP");

    await act(async () => {
      fireEvent.click(view.getByTestId("connect-submit"));
    });

    await waitFor(() => expect(view.getByTestId("connect-error")).toBeDefined());
    expect((view.getByTestId("connect-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  test("says where a pairing code comes from, with the channel's command and no loopback curl", async () => {
    const { view } = await showApp();
    const help = view.getByTestId("connect-pairing-help").textContent ?? "";

    expect(help).toBe(
      "Get a code on the host: AOP settings › Host › Pair a device, or run aop pair there. Any device already paired can also make one.",
    );
    expect(view.container.textContent).not.toContain("curl");
    expect(view.container.textContent).not.toContain("/api/auth/pairing-codes");
  });

  test("offers to set up this Mac only where the app bundles a host", async () => {
    const mac = await showApp();
    fireEvent.click(mac.view.getByTestId("connect-run-local"));
    expect(mac.view.getByTestId("connect-run-local").textContent).toBe("Set up this Mac");
    expect(mac.backend.startHostMode).toHaveBeenCalledTimes(1);
    cleanup();

    const windows = await showApp(makeState({ platform: "win32", hostModeAvailable: false }));
    expect(windows.view.queryByTestId("connect-this-mac")).toBeNull();
    expect(windows.view.getByTestId("connect-another-computer")).toBeDefined();
  });

  test("Change host… is the same screen, with Back to where the app was", async () => {
    const fresh = await showApp();
    expect(fresh.view.queryByTestId("connect-back")).toBeNull();
    cleanup();

    window.location.hash = "#/connect";
    const withHost = await showApp(remote({ status: "connected", host: HOST, hostVersion: "1" }));
    expect(withHost.view.getByText("Connect to a host")).toBeDefined();
    expect((withHost.view.getByTestId("connect-url") as HTMLInputElement).value).toBe(HOST);

    fireEvent.click(withHost.view.getByTestId("connect-back"));
    await waitFor(() => expect(withHost.view.getByTestId("status-screen")).toBeDefined());
  });

  test("tells a person whose device was removed to pair again", async () => {
    window.location.hash = "#/connect";
    const { view } = await showApp(remote({ status: "unauthorized", host: HOST }));

    expect(view.getByTestId("connect-removed").textContent).toContain(
      "no longer accepts this device",
    );
  });

  test("shows This app's update before any dashboard has loaded", async () => {
    const { view } = await showApp(makeState(), {
      status: "available",
      version: "0.10.0",
      releaseUrl: null,
      mode: "notice",
    });

    await waitFor(() => expect(view.getByTestId("app-update")).toBeDefined());
    expect(view.getByTestId("app-update-action").textContent).toBe("Download");
  });
});
