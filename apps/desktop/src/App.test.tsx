import { beforeEach, describe, expect, test } from "bun:test";
import { App } from "./App";
import type { DesktopState } from "./backend/types";
import { createFakeBackend, makeState } from "./test/fake-backend";
import { setupDesktopDom } from "./test/setup-dom";

setupDesktopDom();

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");

const HOST = "https://mac.tail1234.ts.net";

const show = async (state: DesktopState = makeState()) => {
  const fake = createFakeBackend(state);
  const view = render(<App backend={fake.backend} />);
  await waitFor(() => expect(view.container.querySelector("main")).not.toBeNull());
  return { ...fake, view };
};

const type = (view: ReturnType<typeof render>, testId: string, value: string) =>
  fireEvent.change(view.getByTestId(testId), { target: { value } });

beforeEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("first run", () => {
  test("asks for the host's address and a pairing code, with this computer's name filled in", async () => {
    const { view } = await show();

    expect(view.getByTestId("connect-screen")).toBeDefined();
    expect(view.getByText("Connect to your AOP host")).toBeDefined();
    expect((view.getByTestId("connect-device-name") as HTMLInputElement).value).toBe(
      "Marcelo's MacBook",
    );
    expect((view.getByTestId("connect-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("connects with what was typed, code in capitals", async () => {
    const { view, backend } = await show();

    type(view, "connect-url", "mac.tail1234.ts.net");
    type(view, "connect-code", "k7qm-4xnp");
    fireEvent.submit(view.getByTestId("connect-submit").closest("form") as HTMLFormElement);

    await waitFor(() => expect(backend.connectHost).toHaveBeenCalledTimes(1));
    expect(backend.connectHost).toHaveBeenCalledWith({
      url: "mac.tail1234.ts.net",
      code: "K7QM-4XNP",
      deviceName: "Marcelo's MacBook",
    });
  });

  test("says why a connection failed and lets the person try again", async () => {
    const { view, backend } = await show();
    backend.connectHost.mockImplementationOnce(async () => ({
      ok: false as const,
      code: "wrong-code" as const,
      message: "Wrong or expired pairing code. Ask the host for a new one.",
    }));
    type(view, "connect-url", HOST);
    type(view, "connect-code", "WRONG");

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
    const { view, backend } = await show();
    backend.connectHost.mockImplementationOnce(async () => {
      throw new Error("IPC closed");
    });
    type(view, "connect-url", HOST);
    type(view, "connect-code", "K7QM-4XNP");

    await act(async () => {
      fireEvent.click(view.getByTestId("connect-submit"));
    });

    await waitFor(() => expect(view.getByTestId("connect-error")).toBeDefined());
    expect((view.getByTestId("connect-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  test("explains where a pairing code comes from", async () => {
    const { view } = await show();

    expect(view.getByTestId("connect-pairing-command").textContent).toContain(
      "/api/auth/pairing-codes",
    );
  });

  test("offers to run the host on this Mac only where the app can", async () => {
    const mac = await show();
    fireEvent.click(mac.view.getByTestId("connect-run-local"));
    expect(mac.backend.startHostMode).toHaveBeenCalledTimes(1);
    cleanup();

    const windows = await show(makeState({ platform: "win32", hostModeAvailable: false }));
    expect(windows.view.queryByTestId("connect-run-local")).toBeNull();
  });

  test("has no Back button until there is a host to go back to", async () => {
    const fresh = await show();
    expect(fresh.view.queryByTestId("connect-back")).toBeNull();
    cleanup();

    window.location.hash = "#/connect";
    const withHost = await show(
      makeState({
        mode: "remote",
        remoteUrl: HOST,
        connection: { status: "connected", host: HOST, hostVersion: "1" },
      }),
    );
    expect(withHost.view.getByTestId("connect-back")).toBeDefined();
    expect((withHost.view.getByTestId("connect-url") as HTMLInputElement).value).toBe(HOST);
  });

  test("tells a person whose device was removed to pair again", async () => {
    window.location.hash = "#/connect";
    const { view } = await show(
      makeState({
        mode: "remote",
        remoteUrl: HOST,
        connection: { status: "unauthorized", host: HOST },
      }),
    );

    expect(view.getByTestId("connect-removed").textContent).toContain(
      "no longer accepts this device",
    );
  });
});

describe("a remote host", () => {
  const remote = (connection: DesktopState["connection"]) =>
    makeState({ mode: "remote", remoteUrl: HOST, connection });

  test("connected: names the host and its version, and opens the dashboard", async () => {
    const { view, backend } = await show(
      remote({ status: "connected", host: HOST, hostVersion: "0.9.51" }),
    );

    expect(view.getByTestId("status-label").textContent).toBe("Connected to mac.tail1234.ts.net");
    expect(view.getByTestId("status-label").getAttribute("data-tone")).toBe("ok");
    expect(view.getByTestId("status-host-version").textContent).toBe("0.9.51");
    fireEvent.click(view.getByTestId("status-open-dashboard"));
    expect(backend.openDashboard).toHaveBeenCalledTimes(1);
  });

  test("unreachable: says why, offers to check again, and has no dashboard to open", async () => {
    const { view, backend } = await show(
      remote({ status: "unreachable", host: HOST, message: "The host refused the connection." }),
    );

    expect(view.getByTestId("status-explanation").textContent).toContain(
      "The host refused the connection.",
    );
    expect(view.queryByTestId("status-open-dashboard")).toBeNull();
    fireEvent.click(view.getByTestId("status-retry"));
    expect(backend.reconnect).toHaveBeenCalledTimes(1);
  });

  test("refused token: offers to pair again", async () => {
    const { view } = await show(remote({ status: "unauthorized", host: HOST }));

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
    const { view } = await show(
      remote({ status: "incompatible", host: HOST, reason, hostVersion: "9" }),
    );

    expect(view.getByTestId("status-explanation").textContent).toContain(expected);
  });

  test("Change host goes to the connect screen, and Back returns", async () => {
    const { view } = await show(remote({ status: "connected", host: HOST, hostVersion: "1" }));

    fireEvent.click(view.getByTestId("status-change-host"));
    await waitFor(() => expect(view.getByTestId("connect-screen")).toBeDefined());

    fireEvent.click(view.getByTestId("connect-back"));
    await waitFor(() => expect(view.getByTestId("status-screen")).toBeDefined());
  });

  test("Disconnect forgets the host", async () => {
    const { view, backend } = await show(
      remote({ status: "connected", host: HOST, hostVersion: "1" }),
    );

    fireEvent.click(view.getByTestId("status-disconnect"));

    expect(backend.forgetHost).toHaveBeenCalledTimes(1);
  });

  test("follows what the app pushes: connecting, then connected", async () => {
    const { view, push } = await show(remote({ status: "connecting", host: HOST }));
    expect(view.getByTestId("status-label").getAttribute("data-tone")).toBe("busy");

    act(() => push(remote({ status: "connected", host: HOST, hostVersion: "1" })));

    await waitFor(() =>
      expect(view.getByTestId("status-label").getAttribute("data-tone")).toBe("ok"),
    );
  });
});

describe("the host on this Mac", () => {
  const local = (overrides: Partial<DesktopState> = {}) =>
    makeState({ mode: "local", ...overrides });

  test("stopped: offers to start it, and cannot pair a device yet", async () => {
    const { view, backend } = await show(local());

    expect(view.getByTestId("host-status").textContent).toBe("Not running");
    expect((view.getByTestId("host-pairing-create") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByTestId("host-start"));
    expect(backend.startHostMode).toHaveBeenCalledTimes(1);
  });

  test("running: says which port, offers to stop it, and opens the dashboard once connected", async () => {
    const { view, backend } = await show(
      local({
        hostProcess: { status: "running", ownership: "spawned", version: "0.9.51" },
        connection: { status: "connected", host: "http://127.0.0.1:25150", hostVersion: "0.9.51" },
      }),
    );

    expect(view.getByTestId("host-status").textContent).toBe("Running on port 25150");
    expect(view.queryByTestId("host-start")).toBeNull();
    fireEvent.click(view.getByTestId("host-stop"));
    expect(backend.stopHostMode).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByTestId("host-open-dashboard"));
    expect(backend.openDashboard).toHaveBeenCalledTimes(1);
  });

  test("says when it is using a host that was already running", async () => {
    const { view } = await show(
      local({ hostProcess: { status: "running", ownership: "adopted", version: "0.9.40" } }),
    );

    expect(view.getByTestId("host-status").textContent).toContain("already running");
  });

  test("failed: shows the reason, and offers to start it again", async () => {
    const { view } = await show(
      local({
        hostProcess: { status: "failed", message: "Port 25150 is used by another program." },
      }),
    );

    expect(view.getByTestId("host-error").textContent).toContain("Port 25150 is used");
    expect(view.getByTestId("host-start")).toBeDefined();
  });

  test("starting: cannot be started or stopped a second time", async () => {
    const { view } = await show(local({ hostProcess: { status: "starting" } }));

    expect((view.getByTestId("host-stop") as HTMLButtonElement).disabled).toBe(true);
  });

  test("the Tailscale toggle shows the command to run, and only then", async () => {
    const { view, backend, push } = await show(local());
    expect(view.queryByTestId("host-tailscale-command")).toBeNull();

    fireEvent.click(view.getByTestId("host-tailscale-toggle"));
    expect(backend.setServeOverTailscale).toHaveBeenCalledWith(true);

    act(() => push(local({ serveOverTailscale: true })));
    await waitFor(() => expect(view.getByTestId("host-tailscale-command")).toBeDefined());
    expect(view.getByTestId("host-tailscale-command").textContent).toBe(
      "tailscale serve --bg --https=443 http://127.0.0.1:25150",
    );
    expect(view.getByTestId("host-tailscale-toggle").getAttribute("aria-checked")).toBe("true");
    expect(view.getByTestId("host-tailscale-steps").textContent).toContain("tailscale serve reset");
  });

  test("hands out a pairing code for another device", async () => {
    const { view, backend } = await show(
      local({ hostProcess: { status: "running", ownership: "spawned", version: "1" } }),
    );

    await act(async () => {
      fireEvent.click(view.getByTestId("host-pairing-create"));
    });

    await waitFor(() => expect(view.getByTestId("host-pairing-code")).toBeDefined());
    expect(view.getByTestId("host-pairing-code").textContent).toBe("K7QM-4XNP");
    expect(backend.createPairingCode).toHaveBeenCalledTimes(1);
  });

  test("shows why a pairing code could not be made", async () => {
    const { view, backend } = await show(
      local({ hostProcess: { status: "running", ownership: "spawned", version: "1" } }),
    );
    backend.createPairingCode.mockImplementationOnce(async () => ({
      ok: false as const,
      message: "The host would not give a code to this app.",
    }));

    await act(async () => {
      fireEvent.click(view.getByTestId("host-pairing-create"));
    });

    await waitFor(() => expect(view.getByTestId("host-pairing-error")).toBeDefined());
  });

  test("connecting to a different host goes to the connect screen", async () => {
    const { view } = await show(local());

    fireEvent.click(view.getByTestId("host-change"));

    await waitFor(() => expect(view.getByTestId("connect-screen")).toBeDefined());
  });

  test("opens the logs folder", async () => {
    const { view, backend } = await show(local());

    fireEvent.click(view.getByTestId("host-open-logs"));

    expect(backend.openLogsFolder).toHaveBeenCalledTimes(1);
  });
});

describe("the app's address decides the screen", () => {
  test("#/host shows the host screen, and a build without host mode falls back to connect", async () => {
    window.location.hash = "#/host";
    const mac = await show(makeState({ mode: "remote", remoteUrl: HOST }));
    expect(mac.view.getByTestId("host-screen")).toBeDefined();
    cleanup();

    const windows = await show(makeState({ hostModeAvailable: false }));
    expect(windows.view.getByTestId("connect-screen")).toBeDefined();
  });

  test("stops listening for pushed state when the window goes away", async () => {
    const { view, listenerCount } = await show();
    expect(listenerCount()).toBe(1);

    view.unmount();

    expect(listenerCount()).toBe(0);
  });
});
