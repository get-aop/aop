import { describe, expect, mock, test } from "bun:test";
import type { MenuItemConstructorOptions } from "electron";
import { buildMenuTemplate, type MenuActions, type MenuModel } from "./chrome";

const HOST = "https://mac.tail1234.ts.net";

describe("buildMenuTemplate", () => {
  const actions = (): MenuActions => ({
    showDashboard: mock(() => {}),
    openSettings: mock(() => {}),
    reconnect: mock(() => {}),
    changeHost: mock(() => {}),
    manageHost: mock(() => {}),
    startHost: mock(() => {}),
    stopHost: mock(() => {}),
    openUpdateDownload: mock(() => {}),
    restartToUpdate: mock(() => {}),
    quit: mock(() => {}),
  });
  const model = (overrides: Partial<MenuModel> = {}): MenuModel => ({
    platform: "darwin",
    connection: { status: "connected", host: HOST, hostVersion: "0.9.51" },
    hostProcess: { status: "stopped" },
    hostModeAvailable: false,
    update: { status: "idle" },
    appVersion: "0.9.51",
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

  test("on a Mac, Quit (⌘Q) quits through the app, not the native terminate action", () => {
    const menuActions = actions();
    const appMenu = buildMenuTemplate(model(), menuActions)[0];
    const items = (appMenu?.submenu ?? []) as MenuItemConstructorOptions[];
    const quit = items.find((item) => item.label === "Quit");

    expect(appMenu?.role).toBe("appMenu");
    expect(items.some((item) => item.role === "quit")).toBe(false);
    expect(quit?.accelerator).toBe("Command+Q");
    quit?.click?.({} as never, undefined, {} as never);
    expect(menuActions.quit).toHaveBeenCalledTimes(1);
  });

  test("on a Mac, the app menu has Settings… (⌘,), which opens the AOP settings", () => {
    const menuActions = actions();
    const items = (buildMenuTemplate(model(), menuActions)[0]?.submenu ??
      []) as MenuItemConstructorOptions[];
    const settings = items.find((item) => item.label === "Settings…");

    expect(items.indexOf(settings as MenuItemConstructorOptions)).toBe(2);
    expect(settings?.accelerator).toBe("CommandOrControl+,");
    expect(settings?.enabled).toBe(true);
    settings?.click?.({} as never, undefined, {} as never);
    expect(menuActions.openSettings).toHaveBeenCalledTimes(1);
  });

  test("Settings… is off until the app has a host to talk to", () => {
    const items = (buildMenuTemplate(
      model({ connection: { status: "unreachable", host: HOST, message: "down" } }),
      actions(),
    )[0]?.submenu ?? []) as MenuItemConstructorOptions[];

    expect(items.find((item) => item.label === "Settings…")?.enabled).toBe(false);
  });

  test("a Windows app has a File menu to quit from instead of an app menu", () => {
    const template = buildMenuTemplate(model({ platform: "win32" }), actions());

    expect(template[0]?.label).toBe("File");
    const file = (template[0]?.submenu ?? []) as MenuItemConstructorOptions[];
    expect(file[0]?.label).toBe("Settings…");
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

  const topLevel = (template: MenuItemConstructorOptions[]) => template.map((item) => item.label);

  test("has no update menu until there is an update to offer", () => {
    expect(topLevel(buildMenuTemplate(model(), actions()))).not.toContain(
      "Update available (0.10.0)",
    );
  });

  test("offers the download of an available update, and the restart of a downloaded one", () => {
    const wired = actions();
    const available = buildMenuTemplate(
      model({ update: { status: "available", version: "0.10.0", releaseUrl: null } }),
      wired,
    ).find((item) => item.label === "Update available (0.10.0)");
    const ready = buildMenuTemplate(
      model({ update: { status: "ready", version: "0.10.0" } }),
      wired,
    ).find((item) => item.label === "Restart to update (0.10.0)");

    const [download] = (available?.submenu ?? []) as MenuItemConstructorOptions[];
    const [restart] = (ready?.submenu ?? []) as MenuItemConstructorOptions[];
    download?.click?.({} as never, undefined, {} as never);
    restart?.click?.({} as never, undefined, {} as never);

    expect(download?.label).toBe("Download 0.10.0…");
    expect(wired.openUpdateDownload).toHaveBeenCalledTimes(1);
    expect(wired.restartToUpdate).toHaveBeenCalledTimes(1);
  });

  test("tells the person when the host is on another release than the app", () => {
    const newer = hostMenu(
      buildMenuTemplate(
        model({ connection: { status: "connected", host: HOST, hostVersion: "0.10.0+abc1234" } }),
        actions(),
      ),
    );
    const same = hostMenu(
      buildMenuTemplate(
        model({ connection: { status: "connected", host: HOST, hostVersion: "0.9.51" } }),
        actions(),
      ),
    );

    expect(labels(newer)).toContain(
      "The host (0.10.0) is newer than this app (0.9.51). Update the app.",
    );
    expect(labels(same).some((label) => label?.startsWith("The host ("))).toBe(false);
  });
});
