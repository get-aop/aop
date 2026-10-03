import { beforeEach, describe, expect, test } from "bun:test";
import type { DesktopState } from "../backend/types";
import { makeState } from "../test/fake-backend";
import { setupDesktopDom } from "../test/setup-dom";
import { showApp } from "../test/show-app";

setupDesktopDom();

const { act, cleanup, fireEvent, waitFor } = await import("@testing-library/react");

beforeEach(() => {
  cleanup();
  window.location.hash = "";
});

const local = (overrides: Partial<DesktopState> = {}) => makeState({ mode: "local", ...overrides });
const running = { status: "running", ownership: "spawned", version: "1" } as const;

describe("the host on this Mac", () => {
  test("stopped: offers to start it, and cannot pair a device yet", async () => {
    const { view, backend } = await showApp(local());

    expect(view.getByTestId("host-status").textContent).toBe("Not running");
    expect((view.getByTestId("host-pairing-create") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByTestId("host-start"));
    expect(backend.startHostMode).toHaveBeenCalledTimes(1);
  });

  test("running: says which port, offers to stop it, and opens the dashboard once connected", async () => {
    const { view, backend } = await showApp(
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
    const { view } = await showApp(
      local({ hostProcess: { status: "running", ownership: "adopted", version: "0.9.40" } }),
    );

    expect(view.getByTestId("host-status").textContent).toContain("running outside the app");
    expect(view.queryByTestId("host-stop")).toBeNull();
    expect(view.queryByTestId("host-start")).toBeNull();
    expect(view.getByTestId("host-managed-elsewhere").textContent).toContain("background service");
    expect(view.getByTestId("host-stop-command").textContent).toBe(
      "launchctl unload ~/Library/LaunchAgents/com.aop.local-server.plist",
    );
  });

  test("failed: shows the reason, and offers to start it again", async () => {
    const { view } = await showApp(
      local({
        hostProcess: { status: "failed", message: "Port 25150 is used by another program." },
      }),
    );

    expect(view.getByTestId("host-error").textContent).toContain("Port 25150 is used");
    expect(view.getByTestId("host-start")).toBeDefined();
  });

  test("starting: cannot be started or stopped a second time", async () => {
    const { view } = await showApp(local({ hostProcess: { status: "starting" } }));

    expect((view.getByTestId("host-stop") as HTMLButtonElement).disabled).toBe(true);
  });

  test("the Tailscale toggle shows the command to run, and only then", async () => {
    const { view, backend, push } = await showApp(local());
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
    const { view, backend } = await showApp(local({ hostProcess: running }));

    await act(async () => {
      fireEvent.click(view.getByTestId("host-pairing-create"));
    });

    await waitFor(() => expect(view.getByTestId("host-pairing-code")).toBeDefined());
    expect(view.getByTestId("host-pairing-code").textContent).toBe("K7QM-4XNP");
    expect(backend.createPairingCode).toHaveBeenCalledTimes(1);
  });

  test("shows why a pairing code could not be made", async () => {
    const { view, backend } = await showApp(local({ hostProcess: running }));
    backend.createPairingCode.mockImplementationOnce(async () => ({
      ok: false as const,
      message: "The host would not give a code to this app.",
    }));

    await act(async () => {
      fireEvent.click(view.getByTestId("host-pairing-create"));
    });

    await waitFor(() => expect(view.getByTestId("host-pairing-error")).toBeDefined());
  });

  test("Change host… goes to the connect screen", async () => {
    const { view } = await showApp(local());

    fireEvent.click(view.getByTestId("host-change"));

    await waitFor(() => expect(view.getByTestId("connect-screen")).toBeDefined());
  });

  test("opens the logs folder", async () => {
    const { view, backend } = await showApp(local());

    fireEvent.click(view.getByTestId("host-open-logs"));

    expect(backend.openLogsFolder).toHaveBeenCalledTimes(1);
  });

  test("shows This app's update, and that the host here updates with it", async () => {
    const { view } = await showApp(local({ hostProcess: running }), {
      status: "ready",
      version: "0.10.0",
      releaseUrl: null,
    });

    await waitFor(() =>
      expect(view.getByTestId("app-update-action").textContent).toBe("Restart to update"),
    );
    expect(view.getByTestId("host-updates-with-app").textContent).toBe(
      "The host on this Mac updates with this app.",
    );
    expect(view.container.textContent).not.toContain("Update host");
  });
});
