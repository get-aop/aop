import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Device } from "@aop/common";
import { mockApi } from "../test/mock-api";
import { setupDashboardDom } from "../test/setup-dom";
import { makeDevice } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ConfirmationHost } = await import("../components/ConfirmationHost");
const { HostDevices } = await import("./settings-devices");

let api: ReturnType<typeof mockApi>;
let devices: Device[];
let codeExpiresAt: () => string;
let respond: (method: string, path: string) => Response | undefined;

beforeEach(() => {
  window.localStorage.clear();
  devices = [makeDevice()];
  codeExpiresAt = () => new Date(Date.now() + 9 * 60_000 + 30_000).toISOString();
  respond = () => undefined;
  api = mockApi((call) => {
    if (call.method === "GET" && call.path === "/auth/devices") return Response.json({ devices });
    if (call.method === "POST" && call.path === "/auth/pairing-codes") {
      return Response.json({ code: "K7QM-4XNP", expiresAt: codeExpiresAt() }, { status: 201 });
    }
    return respond(call.method, call.path);
  });
});

afterEach(() => {
  cleanup();
  api.restore();
});

const renderDevices = (
  pollMs?: number,
  access: { canManage?: boolean; currentDeviceId?: string | null } = {},
) =>
  render(
    <>
      <HostDevices
        pollMs={pollMs}
        canManage={access.canManage ?? true}
        currentDeviceId={access.currentDeviceId ?? null}
        blockedReason="Updates for this host can only be started on soulf itself (AOP settings › Updates › Who can update this host)."
      />
      <ConfirmationHost />
    </>,
  );

describe("paired devices", () => {
  test("says which app and version each runs, marks this device, and flags an app older than the host", async () => {
    devices = [
      makeDevice({
        id: "mac",
        name: "Marcelos-MacBook-Pro",
        client: { app: "desktop", version: "0.10.8", platform: "darwin" },
      }),
      makeDevice({
        id: "work",
        name: "Work laptop",
        client: { app: "desktop", version: "0.10.6", platform: "win32" },
        outOfDate: true,
      }),
      makeDevice({
        id: "chrome",
        name: "Chrome on Linux",
        client: { app: "browser", version: null, platform: "linux" },
      }),
    ];
    renderDevices(undefined, { currentDeviceId: "mac" });

    const rows = await screen.findAllByTestId("device-row");
    const [mac, work, chrome] = rows.map((row) => within(row as HTMLElement));
    expect(mac?.getByTestId("device-client").textContent).toBe("AOP app 0.10.8 · macOS");
    expect(mac?.getByTestId("device-current").textContent).toBe("This device");
    expect(mac?.queryByTestId("device-revoke")).toBeNull();
    expect(work?.getByTestId("device-out-of-date").textContent).toBe("Out of date");
    expect(chrome?.getByTestId("device-client").textContent).toBe(
      "Browser · Linux · uses the host's dashboard, always current",
    );
  });

  test("read-only for a viewer who may not manage the host: no revoke, no pairing, and why", async () => {
    renderDevices(undefined, { canManage: false });

    await screen.findAllByTestId("device-row");
    expect(screen.queryByTestId("device-revoke")).toBeNull();
    expect(screen.queryByTestId("devices-generate")).toBeNull();
    expect(screen.getByTestId("devices-readonly").textContent).toContain(
      "can only be started on soulf itself",
    );
  });

  test("lists each device with its name, when it was last seen and when it was paired", async () => {
    devices = [
      makeDevice({ id: "d1", name: "Work laptop" }),
      makeDevice({ id: "d2", name: "Old phone", lastSeenAt: null }),
    ];
    renderDevices();

    const rows = await screen.findAllByTestId("device-row");
    expect(rows.map((row) => row.getAttribute("data-device-id"))).toEqual(["d1", "d2"]);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByTestId("device-name").textContent).toBe("Work laptop");
    expect(first.getByTestId("device-last-seen").textContent).toBe("Last seen 5m ago");
    expect(first.getByTestId("device-created").textContent).toMatch(/^Paired /);
    expect(first.getByTestId("device-created").getAttribute("title")).toBe(
      "2026-09-29T10:00:00.000Z",
    );
    expect(within(rows[1] as HTMLElement).getByTestId("device-last-seen").textContent).toBe(
      "Not seen since it was paired",
    );
  });

  test("says so when no device is paired", async () => {
    devices = [];
    renderDevices();
    expect((await screen.findByTestId("devices-empty")).textContent).toContain(
      "No device is paired yet",
    );
  });

  test("a list that cannot be loaded says why", async () => {
    api.restore();
    api = mockApi(() => Response.json({ error: "Not the host owner" }, { status: 403 }));
    renderDevices();
    expect((await screen.findByTestId("devices-list-error")).textContent).toBe(
      "Not the host owner",
    );
  });

  test("picks up a device paired later, and changes to when one was last seen", async () => {
    renderDevices(30);
    await screen.findByTestId("device-row");

    devices = [...devices, makeDevice({ id: "d2", name: "Tablet" })];

    await waitFor(() => expect(screen.getAllByTestId("device-row")).toHaveLength(2), {
      timeout: 1500,
    });
  });
});

describe("revoking", () => {
  test("asks first, then revokes and drops the row", async () => {
    respond = (method, path) =>
      method === "DELETE" && path === "/auth/devices/dev_1"
        ? new Response(null, { status: 204 })
        : undefined;
    renderDevices();
    fireEvent.click(await screen.findByTestId("device-revoke"));

    await screen.findByText("Revoke “Work laptop”?");
    expect(api.writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      method: "DELETE",
      path: "/auth/devices/dev_1",
      body: undefined,
    });
    await waitFor(() => expect(screen.queryByTestId("device-row")).toBeNull());
    expect(screen.getByTestId("devices-empty")).toBeTruthy();
  });

  test("declining leaves the device paired", async () => {
    renderDevices();
    fireEvent.click(await screen.findByTestId("device-revoke"));
    await screen.findByText("Revoke “Work laptop”?");
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.writes()).toHaveLength(0);
    expect(screen.getByTestId("device-row")).toBeTruthy();
  });

  test("a refused revoke keeps the row", async () => {
    respond = () => Response.json({ error: "Device not found" }, { status: 404 });
    renderDevices();
    fireEvent.click(await screen.findByTestId("device-revoke"));
    await screen.findByText("Revoke “Work laptop”?");
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(screen.getByTestId("device-row")).toBeTruthy();
  });
});

describe("pairing code", () => {
  test("is generated on demand and counts down to its expiry", async () => {
    renderDevices();
    const generate = (await screen.findByTestId("devices-generate")) as HTMLButtonElement;
    expect(screen.queryByTestId("devices-code")).toBeNull();

    fireEvent.click(generate);

    const code = await screen.findByTestId("devices-code");
    expect(code.textContent).toBe("K7QM-4XNP");
    expect(Date.parse(code.getAttribute("data-expires-at") as string)).toBeGreaterThan(Date.now());
    expect(screen.getByTestId("devices-code-countdown").textContent).toMatch(
      /^Expires in 9:(2[89]|3[01])$/,
    );
    expect(api.writes()).toEqual([
      { method: "POST", path: "/auth/pairing-codes", body: undefined },
    ]);
    expect(generate.textContent).toBe("Generate a new code");
  });

  test("an expired code says so", async () => {
    codeExpiresAt = () => new Date(Date.now() - 1000).toISOString();
    renderDevices();
    fireEvent.click(await screen.findByTestId("devices-generate"));

    await screen.findByTestId("devices-code");
    expect(screen.getByTestId("devices-code-countdown").textContent).toBe("Expired");
    expect(screen.getByTestId("devices-code-card").getAttribute("data-expired")).toBe("true");
  });

  test("a new code replaces the one on screen", async () => {
    let issued = 0;
    api.restore();
    api = mockApi((call) => {
      if (call.path === "/auth/devices") return Response.json({ devices });
      issued += 1;
      return Response.json(
        { code: `CODE-000${issued}`, expiresAt: codeExpiresAt() },
        { status: 201 },
      );
    });
    renderDevices();
    fireEvent.click(await screen.findByTestId("devices-generate"));
    await waitFor(() => expect(screen.getByTestId("devices-code").textContent).toBe("CODE-0001"));

    fireEvent.click(screen.getByTestId("devices-generate"));
    await waitFor(() => expect(screen.getByTestId("devices-code").textContent).toBe("CODE-0002"));
  });

  test("turns into a confirmation once a device pairs with it", async () => {
    renderDevices(30);
    fireEvent.click(await screen.findByTestId("devices-generate"));
    await screen.findByTestId("devices-code");

    devices = [...devices, makeDevice({ id: "d2", name: "Studio Mac", lastSeenAt: null })];

    expect(
      (await screen.findByTestId("devices-paired-notice", {}, { timeout: 1500 })).textContent,
    ).toBe("Studio Mac is paired.");
    expect(screen.queryByTestId("devices-code")).toBeNull();
  });

  test("a refusal from the host is shown", async () => {
    api.restore();
    api = mockApi((call) =>
      call.path === "/auth/devices"
        ? Response.json({ devices })
        : Response.json({ error: "Only the host owner can pair devices" }, { status: 403 }),
    );
    renderDevices();
    fireEvent.click(await screen.findByTestId("devices-generate"));

    expect((await screen.findByTestId("devices-error")).textContent).toBe(
      "Only the host owner can pair devices",
    );
    expect(screen.queryByTestId("devices-code")).toBeNull();
  });

  test("cannot be asked for before the device list has loaded", async () => {
    renderDevices();
    const generate = screen.getByTestId("devices-generate") as HTMLButtonElement;
    expect(generate.disabled).toBe(true);

    await screen.findByTestId("device-row");
    expect(generate.disabled).toBe(false);
  });
});
