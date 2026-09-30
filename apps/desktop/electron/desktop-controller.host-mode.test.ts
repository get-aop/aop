import { describe, expect, test } from "bun:test";
import { fakeHostClient, flush, HOST } from "./connection/test-utils";
import { createFakeSupervisor, LOCAL, remote, setup, unreachable } from "./controller-test-utils";
import { DEFAULT_LOCAL_PORT } from "./host-config/config-store";

describe("running the host on this Mac", () => {
  test("starting it shows the host screen, runs the server, and follows it as the owner", async () => {
    const supervisor = createFakeSupervisor();
    const { controller, window, config, watcherTargets } = await setup({ supervisor });
    await controller.boot();

    await controller.startHostMode();
    await flush();

    expect(window.calls).toEqual(["shell:connect", "shell:host"]);
    expect(supervisor.record.starts).toBe(1);
    expect((await config.load()).mode).toBe("local");
    expect(controller.state().connection).toMatchObject({ status: "connected", host: LOCAL });
    expect(watcherTargets).toEqual([{ baseUrl: LOCAL, token: null }]);
  });

  test("does not follow a host that failed to start", async () => {
    const supervisor = createFakeSupervisor({ status: "failed", message: "Port in use." });
    const { controller, watched } = await setup({ supervisor });
    await controller.boot();

    await controller.startHostMode();

    expect(watched).toEqual(["stop"]);
    expect(controller.state().connection).toEqual({ status: "unconfigured" });
  });

  test("stopping it stops the notifications and the connection to it", async () => {
    const supervisor = createFakeSupervisor();
    const { controller, watched } = await setup({ supervisor });
    await controller.boot();
    await controller.startHostMode();
    await flush();

    await controller.stopHostMode();

    expect(supervisor.record.stops).toBe(1);
    expect(watched.at(-1)).toBe("stop");
    expect(controller.state().connection).toEqual({ status: "unconfigured" });
  });

  test("refuses to start where the app cannot run a host", async () => {
    const { controller } = await setup({ supervisor: null });

    await expect(controller.startHostMode()).rejects.toThrow("cannot run a host");
  });

  test("makes a pairing code for another device, on the host's own Mac only", async () => {
    const { controller } = await setup();
    await controller.boot();

    expect(await controller.createPairingCode()).toMatchObject({ ok: false });

    await controller.startHostMode();
    expect(await controller.createPairingCode()).toEqual({
      ok: true,
      code: "K7QM-4XNP",
      expiresAt: "2026-09-30T12:00:00.000Z",
    });
  });

  test("passes on why the host would not give a code", async () => {
    const client = fakeHostClient({ createPairingCode: async () => ({ status: "not-owner" }) });
    const { controller } = await setup({ client });
    await controller.boot();
    await controller.startHostMode();

    const result = await controller.createPairingCode();

    expect(result.ok === false && result.message).toContain("on this Mac");
  });

  test("remembers whether to show the Tailscale command, and tells the screens", async () => {
    const { controller, config, changes } = await setup();
    await controller.boot();

    await controller.setServeOverTailscale(true);

    expect((await config.load()).serveOverTailscale).toBe(true);
    expect(changes.at(-1)?.serveOverTailscale).toBe(true);
    expect(controller.state().tailscale.serveCommand).toBe(
      `tailscale serve --bg --https=443 http://127.0.0.1:${DEFAULT_LOCAL_PORT}`,
    );
  });
});

describe("a window that comes back", () => {
  test("shows the dashboard again while connected, and the status screen while it is not", async () => {
    const connected = await setup({ config: remote });
    await connected.controller.boot();
    await flush();
    await connected.controller.reopen();

    const away = await setup({ config: remote, client: unreachable });
    await away.controller.boot();
    await away.controller.reopen();

    expect(connected.window.calls).toEqual(["dashboard", "dashboard"]);
    expect(away.window.calls).toEqual(["shell:status", "shell:status"]);
  });

  test("shows the host screen for a host on this Mac that is not running, and the connect screen for no host", async () => {
    const supervisor = createFakeSupervisor({ status: "failed", message: "x" });
    const local = await setup({ config: { mode: "local" }, supervisor });
    await local.controller.boot();
    await local.controller.reopen();
    const fresh = await setup();
    await fresh.controller.reopen();

    expect(local.window.calls).toEqual(["shell:host", "shell:host"]);
    expect(fresh.window.calls).toEqual(["shell:connect"]);
  });

  test("names the host the dashboard talks to, for its content security policy", async () => {
    const { controller } = await setup({ config: remote });
    expect(controller.activeHostUrl()).toBeNull();

    await controller.boot();

    expect(controller.activeHostUrl()).toBe(HOST);
  });
});

describe("notifications and shutdown", () => {
  test("a click on a notification brings the window forward and opens what it is about", async () => {
    const { controller, window } = await setup({ config: remote });
    await controller.boot();
    await flush();

    await controller.openTarget({ projectId: "prj_1", threadId: "thr_9" });
    await controller.openTarget({ projectId: "prj_1", threadId: null });

    expect(window.calls.slice(-4)).toEqual([
      "focus",
      "dashboard:/projects/prj_1/threads/thr_9",
      "focus",
      "dashboard:/projects/prj_1/chat",
    ]);
  });

  test("shutting down stops the notifications, the monitor and the host", async () => {
    const supervisor = createFakeSupervisor();
    const { controller, watched, monitor } = await setup({ config: { mode: "local" }, supervisor });
    await controller.boot();
    await flush();

    await controller.shutdown();

    expect(watched.at(-1)).toBe("stop");
    expect(supervisor.record.stops).toBe(1);
    expect(monitor.state()).toEqual({ status: "unconfigured" });
  });

  test("tells its listeners whenever the connection changes", async () => {
    const { controller, changes } = await setup({ config: remote });

    await controller.boot();
    await flush();

    expect(changes.map((state) => state.connection.status)).toContain("connected");
    expect(changes.at(-1)).toMatchObject({
      mode: "remote",
      remoteUrl: HOST,
      appVersion: "0.9.51",
      defaultDeviceName: "Work laptop",
    });
  });

  test("offers the machine's own name for a device that has none yet", async () => {
    const { controller } = await setup();

    expect(controller.state().defaultDeviceName).toBe("Marcelo's MacBook");
  });
});
