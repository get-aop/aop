import { describe, expect, mock, test } from "bun:test";
import type { MenuItemConstructorOptions } from "electron";
import { aboutPanelOptions, buildMenuTemplate, type MenuActions, type MenuModel } from "./chrome";

const HOST = "https://mac.tail1234.ts.net";

const actions = (): MenuActions => ({
  showDashboard: mock(() => {}),
  openSettings: mock(() => {}),
  openHostSetup: mock(() => {}),
  reconnect: mock(() => {}),
  changeHost: mock(() => {}),
  manageHost: mock(() => {}),
  startHost: mock(() => {}),
  stopHost: mock(() => {}),
  checkForUpdates: mock(() => {}),
  restartToUpdate: mock(() => {}),
  quit: mock(() => {}),
});
const model = (overrides: Partial<MenuModel> = {}): MenuModel => ({
  platform: "darwin",
  connection: { status: "connected", host: HOST, hostVersion: "0.9.51" },
  hostProcess: { status: "stopped" },
  hostModeAvailable: false,
  update: { status: "idle", checkedAt: null },
  ...overrides,
});
const submenu = (item: MenuItemConstructorOptions | undefined) =>
  (item?.submenu ?? []) as MenuItemConstructorOptions[];
const hostMenu = (template: MenuItemConstructorOptions[]) =>
  submenu(template.find((item) => item.label === "Host"));
const labels = (items: MenuItemConstructorOptions[]) =>
  items.filter((item) => item.label).map((item) => item.label);
const click = (item: MenuItemConstructorOptions | undefined) =>
  item?.click?.({} as never, undefined, {} as never);

describe("buildMenuTemplate", () => {
  test("keeps the standard edit, view and window menus, which copy and paste depend on", () => {
    const roles = buildMenuTemplate(model(), actions()).map((item) => item.role);

    expect(roles).toEqual(
      expect.arrayContaining(["appMenu", "editMenu", "viewMenu", "windowMenu"]),
    );
  });

  test("on a Mac, Quit (⌘Q) quits through the app, not the native terminate action", () => {
    const menuActions = actions();
    const appMenu = buildMenuTemplate(model(), menuActions)[0];
    const items = submenu(appMenu);
    const quit = items.find((item) => item.label === "Quit");

    expect(appMenu?.role).toBe("appMenu");
    expect(items.some((item) => item.role === "quit")).toBe(false);
    expect(quit?.accelerator).toBe("Command+Q");
    click(quit);
    expect(menuActions.quit).toHaveBeenCalledTimes(1);
  });

  test("on a Mac, the app menu has About, one update item, then Settings… (⌘,)", () => {
    const menuActions = actions();
    const items = submenu(buildMenuTemplate(model(), menuActions)[0]);
    const settings = items.find((item) => item.label === "Settings…");

    expect(items[0]?.role).toBe("about");
    expect(items[1]?.label).toBe("Check for Updates…");
    expect(items.indexOf(settings as MenuItemConstructorOptions)).toBe(3);
    expect(settings?.accelerator).toBe("CommandOrControl+,");
    expect(settings?.enabled).toBe(true);
    click(settings);
    expect(menuActions.openSettings).toHaveBeenCalledTimes(1);
  });

  test("Settings… is off until the app has a host to talk to", () => {
    const items = submenu(
      buildMenuTemplate(
        model({ connection: { status: "unreachable", host: HOST, message: "down" } }),
        actions(),
      )[0],
    );

    expect(items.find((item) => item.label === "Settings…")?.enabled).toBe(false);
  });

  test("a Windows app has a File menu to quit from, and Help with About and the update item", () => {
    const template = buildMenuTemplate(model({ platform: "win32" }), actions());

    expect(template[0]?.label).toBe("File");
    expect(submenu(template[0])[0]?.label).toBe("Settings…");
    const help = template.at(-1);
    expect(help?.label).toBe("Help");
    expect(submenu(help)[0]?.role).toBe("about");
    expect(submenu(help)[1]?.label).toBe("Check for Updates…");
  });

  test("shows how the app stands with its host, and offers to change it and set it up", () => {
    const items = hostMenu(buildMenuTemplate(model(), actions()));

    expect(labels(items)).toEqual([
      "Connected to mac.tail1234.ts.net",
      "Show Dashboard",
      "Reconnect",
      "Change Host…",
      "Host Setup…",
    ]);
    expect(items[0]?.enabled).toBe(false);
  });

  test("offers the dashboard and Host Setup… only while connected", () => {
    const items = hostMenu(
      buildMenuTemplate(
        model({ connection: { status: "unreachable", host: HOST, message: "x" } }),
        actions(),
      ),
    );

    expect(items.find((item) => item.label === "Show Dashboard")?.enabled).toBe(false);
    expect(items.find((item) => item.label === "Host Setup…")?.enabled).toBe(false);
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

    expect(labels(withHost)).toContain("Host on This Mac…");
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

  test("wires each Host item to its action", () => {
    const wired = actions();
    const items = hostMenu(buildMenuTemplate(model({ hostModeAvailable: true }), wired));

    for (const item of items) click(item);

    expect(wired.showDashboard).toHaveBeenCalledTimes(1);
    expect(wired.reconnect).toHaveBeenCalledTimes(1);
    expect(wired.changeHost).toHaveBeenCalledTimes(1);
    expect(wired.openHostSetup).toHaveBeenCalledTimes(1);
    expect(wired.manageHost).toHaveBeenCalledTimes(1);
    expect(wired.startHost).toHaveBeenCalledTimes(1);
  });

  test("never shows the host's version drift or a top-level update menu", () => {
    const template = buildMenuTemplate(
      model({
        connection: { status: "connected", host: HOST, hostVersion: "0.10.0+abc1234" },
        update: { status: "ready", version: "0.10.0", releaseUrl: null },
      }),
      actions(),
    );

    expect(labels(hostMenu(template)).some((label) => label?.includes("0.10.0"))).toBe(false);
    expect(template.map((item) => item.label ?? item.role)).toEqual([
      "appMenu",
      "Host",
      "editMenu",
      "viewMenu",
      "windowMenu",
    ]);
  });
});

describe("the update item", () => {
  const updateItem = (update: MenuModel["update"], wired = actions()) =>
    submenu(buildMenuTemplate(model({ update }), wired)[0])[1];

  test("checks for updates, and is greyed while a check runs", () => {
    const wired = actions();
    const item = updateItem({ status: "error", message: "x", version: null }, wired);

    click(item);

    expect(item?.label).toBe("Check for Updates…");
    expect(wired.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updateItem({ status: "checking" })?.enabled).toBe(false);
    expect(updateItem({ status: "downloading", version: "0.10.0", percent: 4 })?.label).toBe(
      "Check for Updates…",
    );
  });

  test("restarts onto a downloaded build", () => {
    const wired = actions();
    const item = updateItem({ status: "ready", version: "0.10.0+abc", releaseUrl: null }, wired);

    click(item);

    expect(item?.label).toBe("Restart to Update (0.10.0)");
    expect(wired.restartToUpdate).toHaveBeenCalledTimes(1);
  });

  test("is not there where the app never updates itself", () => {
    expect(updateItem({ status: "off" })?.type).toBe("separator");
  });
});

describe("aboutPanelOptions", () => {
  test("shows the app and its version, and the host with its version", () => {
    expect(
      aboutPanelOptions({
        appName: "AOP Nightly",
        appVersion: "0.10.8-nightly.20261003.4",
        platform: "darwin",
        connection: {
          status: "connected",
          host: "https://soulf.tailffbdec.ts.net:25650",
          hostVersion: "0.10.8-nightly.20261002.17+abc",
        },
      }),
    ).toEqual({
      applicationName: "AOP Nightly",
      applicationVersion: "0.10.8-nightly.20261003.4",
      credits: "Host soulf · 0.10.8-nightly.20261002.17",
    });
  });

  test("says how the connection stands when there is no host version to show, also on Linux", () => {
    expect(
      aboutPanelOptions({
        appName: "AOP",
        appVersion: "0.10.8",
        platform: "linux",
        connection: { status: "unreachable", host: HOST, message: "x" },
      }),
    ).toMatchObject({
      credits: "Cannot reach mac.tail1234.ts.net",
      copyright: "Cannot reach mac.tail1234.ts.net",
    });
  });
});
