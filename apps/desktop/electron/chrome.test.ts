import { describe, expect, mock, test } from "bun:test";
import type { MenuItemConstructorOptions } from "electron";
import { buildMenuTemplate, type MenuActions, type MenuModel } from "./chrome";

const HOST = "https://mac.tail1234.ts.net";

describe("buildMenuTemplate", () => {
  const actions = (): MenuActions => ({
    showDashboard: mock(() => {}),
    reconnect: mock(() => {}),
    changeHost: mock(() => {}),
    manageHost: mock(() => {}),
    startHost: mock(() => {}),
    stopHost: mock(() => {}),
  });
  const model = (overrides: Partial<MenuModel> = {}): MenuModel => ({
    platform: "darwin",
    connection: { status: "connected", host: HOST, hostVersion: "1" },
    hostProcess: { status: "stopped" },
    hostModeAvailable: false,
    ...overrides,
  });
  const hostMenu = (template: MenuItemConstructorOptions[]) =>
    (template.find((item) => item.label === "Host")?.submenu ?? []) as MenuItemConstructorOptions[];
  const labels = (items: MenuItemConstructorOptions[]) =>
    items.filter((item) => item.label).map((item) => item.label);

  test("keeps the standard edit, view and window menus, which copy and paste depend on", () => {
    const roles = buildMenuTemplate(model(), actions()).map((item) => item.role);

    expect(roles).toEqual(
      expect.arrayContaining(["appMenu", "editMenu", "viewMenu", "windowMenu"]),
    );
  });

  test("a Windows app has a File menu to quit from instead of an app menu", () => {
    const template = buildMenuTemplate(model({ platform: "win32" }), actions());

    expect(template[0]?.label).toBe("File");
  });

  test("shows how the app stands with its host, and offers to change it", () => {
    const items = hostMenu(buildMenuTemplate(model(), actions()));

    expect(labels(items)).toEqual([
      "Connected to mac.tail1234.ts.net",
      "Show Dashboard",
      "Reconnect",
      "Change Host…",
    ]);
    expect(items[0]?.enabled).toBe(false);
  });

  test("offers the dashboard only while connected", () => {
    const items = hostMenu(
      buildMenuTemplate(
        model({ connection: { status: "unreachable", host: HOST, message: "x" } }),
        actions(),
      ),
    );

    expect(items.find((item) => item.label === "Show Dashboard")?.enabled).toBe(false);
    expect(items.find((item) => item.label === "Reconnect")?.enabled).toBe(true);
  });

  test("offers nothing to reconnect to before a host is chosen", () => {
    const items = hostMenu(
      buildMenuTemplate(model({ connection: { status: "unconfigured" } }), actions()),
    );

    expect(items.find((item) => item.label === "Reconnect")?.enabled).toBe(false);
  });

  test("offers to run the host only where this build can", () => {
    const withHost = hostMenu(buildMenuTemplate(model({ hostModeAvailable: true }), actions()));
    const without = hostMenu(buildMenuTemplate(model({ hostModeAvailable: false }), actions()));

    expect(labels(withHost)).toContain("Run Host on This Mac");
    expect(labels(without)).not.toContain("Run Host on This Mac");
  });

  test("offers to stop the host while it runs, and to run it while it does not", () => {
    const running = hostMenu(
      buildMenuTemplate(
        model({
          hostModeAvailable: true,
          hostProcess: { status: "running", ownership: "spawned", version: "1" },
        }),
        actions(),
      ),
    );
    const failed = hostMenu(
      buildMenuTemplate(
        model({ hostModeAvailable: true, hostProcess: { status: "failed", message: "x" } }),
        actions(),
      ),
    );

    expect(labels(running)).toContain("Stop Host on This Mac");
    expect(labels(running)).not.toContain("Run Host on This Mac");
    expect(labels(failed)).toContain("Run Host on This Mac");
  });

  test("wires each item to its action", () => {
    const wired = actions();
    const items = hostMenu(buildMenuTemplate(model({ hostModeAvailable: true }), wired));

    for (const item of items) {
      if (typeof item.click === "function") item.click({} as never, undefined, {} as never);
    }

    expect(wired.showDashboard).toHaveBeenCalledTimes(1);
    expect(wired.reconnect).toHaveBeenCalledTimes(1);
    expect(wired.changeHost).toHaveBeenCalledTimes(1);
    expect(wired.manageHost).toHaveBeenCalledTimes(1);
    expect(wired.startHost).toHaveBeenCalledTimes(1);
  });
});
