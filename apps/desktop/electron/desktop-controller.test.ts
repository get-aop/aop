import { describe, expect, test } from "bun:test";
import { fakeHostClient, flush, HOST } from "./connection/test-utils";
import { createFakeSupervisor, LOCAL, remote, setup, unreachable } from "./controller-test-utils";

describe("the first screen", () => {
  test("a fresh install opens the connect screen and talks to no host", async () => {
    const { controller, window, watched } = await setup();

    await controller.boot();

    expect(window.calls).toEqual(["shell:connect"]);
    expect(watched).toEqual([]);
    expect(controller.state().connection).toEqual({ status: "unconfigured" });
  });

  test("a saved host that answers opens the dashboard and starts the notifications", async () => {
    const { controller, window, watcherTargets } = await setup({ config: remote });

    await controller.boot();
    await flush();

    expect(window.calls).toEqual(["dashboard"]);
    expect(watcherTargets).toEqual([{ baseUrl: HOST, token: "aop_saved" }]);
  });

  test("a saved host that does not answer opens the status screen, not a blank dashboard", async () => {
    const { controller, window, watched } = await setup({ config: remote, client: unreachable });

    await controller.boot();

    expect(window.calls).toEqual(["shell:status"]);
    expect(watched).not.toContain("start");
  });

  test("goes on to the dashboard when the host comes back while the status screen is up", async () => {
    let up = false;
    const client = fakeHostClient({
      health: async () =>
        up
          ? {
              status: "ok",
              health: { service: "aop", version: "1", apiVersion: 1, minClientApiVersion: 1 },
            }
          : { status: "unreachable", message: "away", failure: "refused" },
    });
    const { controller, window, clock } = await setup({ config: remote, client });
    await controller.boot();

    up = true;
    clock.fire();
    await flush();
    await flush();

    expect(window.calls).toEqual(["shell:status", "dashboard"]);
  });

  test("does not pull the person off the connect screen when a host answers behind it", async () => {
    const { controller, window } = await setup({ config: remote, client: unreachable });
    await controller.boot();
    await controller.showChangeHost();

    await controller.reconnect();
    await flush();

    expect(window.calls).toEqual(["shell:status", "shell:connect"]);
  });

  test("a saved host with no token in the keychain is paired again", async () => {
    const { controller, window } = await setup({ config: remote, token: null });

    await controller.boot();

    expect(window.calls).toEqual(["shell:connect"]);
  });
});

describe("host mode at launch", () => {
  const local = { mode: "local" } as const;

  test("starts the host, and opens the dashboard as the owner with no token", async () => {
    const supervisor = createFakeSupervisor();
    const { controller, window, watcherTargets } = await setup({ config: local, supervisor });

    await controller.boot();
    await flush();

    expect(supervisor.record.starts).toBe(1);
    expect(window.calls).toEqual(["dashboard"]);
    expect(watcherTargets).toEqual([{ baseUrl: LOCAL, token: null }]);
    expect(await controller.hostConfigForDashboard()).toEqual({ baseUrl: LOCAL, token: null });
  });

  test("opens the host screen, with the reason, when the host will not start", async () => {
    const supervisor = createFakeSupervisor({ status: "failed", message: "Port 25150 is in use." });
    const { controller, window } = await setup({ config: local, supervisor });

    await controller.boot();

    expect(window.calls).toEqual(["shell:host"]);
    expect(controller.state().hostProcess).toEqual({
      status: "failed",
      message: "Port 25150 is in use.",
    });
  });

  test("opens the connect screen where this build cannot run a host", async () => {
    const { controller, window } = await setup({ config: local, supervisor: null });

    await controller.boot();

    expect(window.calls).toEqual(["shell:connect"]);
    expect(controller.state().hostModeAvailable).toBe(false);
  });
});

describe("connecting to a host", () => {
  const input = { url: HOST, code: "K7QM-4XNP", deviceName: "Work laptop" };

  test("pairs, keeps the token, opens the dashboard and starts the notifications", async () => {
    const { controller, window, tokens, config, watcherTargets } = await setup();
    await controller.boot();

    const result = await controller.connectHost(input);
    await flush();

    expect(result).toEqual({ ok: true });
    expect(await tokens.load(HOST)).toBe("aop_new_token");
    expect(await config.load()).toMatchObject({ mode: "remote", remoteUrl: HOST });
    expect(window.calls.at(-1)).toBe("dashboard");
    expect(watcherTargets).toEqual([{ baseUrl: HOST, token: "aop_new_token" }]);
    expect(await controller.hostConfigForDashboard()).toEqual({
      baseUrl: HOST,
      token: "aop_new_token",
    });
  });

  test("a refused code leaves the person on the screen with the reason", async () => {
    const client = fakeHostClient({ pair: async () => ({ status: "wrong-code" }) });
    const { controller, window } = await setup({ client });
    await controller.boot();

    const result = await controller.connectHost(input);

    expect(result).toMatchObject({ ok: false, code: "wrong-code" });
    expect(window.calls).toEqual(["shell:connect"]);
  });

  test("ends the host this app was running, since it is now a client of another", async () => {
    const supervisor = createFakeSupervisor();
    const { controller } = await setup({ config: { mode: "local" }, supervisor });
    await controller.boot();

    await controller.connectHost(input);

    expect(supervisor.record.stops).toBe(1);
  });

  test("turns an unexpected failure into a message instead of a rejected call", async () => {
    const client = fakeHostClient({
      pair: async () => {
        throw new Error("disk full");
      },
    });
    const { controller } = await setup({ client });

    expect(await controller.connectHost(input)).toMatchObject({ ok: false, code: "failed" });
  });
});

describe("when the host turns the device away", () => {
  const revokedAfterConnect = () => {
    let revoked = false;
    const client = fakeHostClient({
      principal: async () =>
        revoked ? { status: "unauthorized" } : { status: "ok", principal: { kind: "owner" } },
    });
    return {
      client,
      revoke: () => {
        revoked = true;
      },
    };
  };

  test("takes the person to the status screen and stops the notifications", async () => {
    const { client, revoke } = revokedAfterConnect();
    const { controller, window, watched, clock } = await setup({ config: remote, client });
    await controller.boot();
    await flush();

    revoke();
    clock.fire();
    await flush();
    await flush();

    expect(window.calls).toEqual(["dashboard", "shell:status"]);
    expect(watched).toEqual(["stop", "start", "stop"]);
    expect(controller.state().connection.status).toBe("unauthorized");
  });

  test("does the same when the dashboard reports a refused token before the next look", async () => {
    const { client, revoke } = revokedAfterConnect();
    const { controller, window } = await setup({ config: remote, client });
    await controller.boot();
    await flush();

    revoke();
    await controller.hostRejected();
    await flush();

    expect(window.calls.at(-1)).toBe("shell:status");
  });

  test("a refused token the host still accepts reloads the dashboard, so it never sits waiting", async () => {
    const { client } = revokedAfterConnect();
    const { controller, window } = await setup({ config: remote, client });
    await controller.boot();
    await flush();

    await controller.hostRejected();
    await flush();
    expect(window.calls).toEqual(["dashboard", "dashboard"]);

    // Refused again: the status screen, not a reload loop.
    await controller.hostRejected();
    await flush();
    expect(window.calls).toEqual(["dashboard", "dashboard", "shell:status"]);
  });

  test("a host that only went quiet does not move the person off the dashboard", async () => {
    let up = true;
    const client = fakeHostClient({
      health: async () =>
        up
          ? {
              status: "ok",
              health: { service: "aop", version: "1", apiVersion: 1, minClientApiVersion: 1 },
            }
          : { status: "unreachable", message: "away", failure: "timeout" },
    });
    const { controller, window, clock } = await setup({ config: remote, client });
    await controller.boot();
    await flush();

    up = false;
    clock.fire();
    await flush();

    expect(controller.state().connection.status).toBe("unreachable");
    expect(window.calls).toEqual(["dashboard"]);
  });

  test("a host on another API version is reported the same way", async () => {
    let tooNew = false;
    const client = fakeHostClient({
      health: async () => ({
        status: "ok",
        health: {
          service: "aop",
          version: "9",
          apiVersion: tooNew ? 5 : 1,
          minClientApiVersion: tooNew ? 4 : 1,
        },
      }),
    });
    const { controller, window, clock } = await setup({ config: remote, client });
    await controller.boot();
    await flush();

    tooNew = true;
    clock.fire();
    await flush();
    await flush();

    expect(window.calls.at(-1)).toBe("shell:status");
    expect(controller.state().connection).toMatchObject({
      status: "incompatible",
      reason: "client-too-old",
    });
  });
});

describe("changing host", () => {
  test("forgetting a host drops its token, stops the notifications and shows the connect screen", async () => {
    const signedOut: string[] = [];
    const client = fakeHostClient({ signOut: async (token) => void signedOut.push(token) });
    const { controller, window, tokens, watched, config } = await setup({ config: remote, client });
    await controller.boot();
    await flush();

    await controller.forgetHost();

    expect(signedOut).toEqual(["aop_saved"]);
    expect(await tokens.load(HOST)).toBeNull();
    expect((await config.load()).mode).toBeNull();
    expect(watched.at(-1)).toBe("stop");
    expect(window.calls.at(-1)).toBe("shell:connect");
    expect(controller.state().connection).toEqual({ status: "unconfigured" });
    await expect(controller.hostConfigForDashboard()).rejects.toThrow("No host");
  });

  test("the menu's Change Host and Host on This Mac only switch screens", async () => {
    const { controller, window, config } = await setup({ config: remote });
    await controller.boot();
    await flush();

    await controller.showChangeHost();
    await controller.showHostMode();

    expect(window.calls.slice(-2)).toEqual(["shell:connect", "shell:host"]);
    expect((await config.load()).mode).toBe("remote");
  });
});
