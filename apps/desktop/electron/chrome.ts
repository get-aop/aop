import type { AppUpdateState } from "@aop/common";
import type { AboutPanelOptionsOptions, MenuItemConstructorOptions } from "electron";
import { connectionLabel, hostShortName } from "../src/backend/connection-label";
import { displayVersion } from "../src/backend/host-version";
import type { ConnectionState, HostProcessState } from "../src/backend/types";

export interface MenuModel {
  platform: NodeJS.Platform;
  connection: ConnectionState;
  hostProcess: HostProcessState;
  hostModeAvailable: boolean;
  update: AppUpdateState;
}

export interface MenuActions {
  showDashboard: () => void;
  /** Opens the AOP settings in the dashboard, showing the dashboard first if it is not. */
  openSettings: () => void;
  /** Opens AOP settings › Host in the dashboard. */
  openHostSetup: () => void;
  reconnect: () => void;
  changeHost: () => void;
  manageHost: () => void;
  startHost: () => void;
  stopHost: () => void;
  /** Checks now, and opens the dashboard's Updates popover. */
  checkForUpdates: () => void;
  restartToUpdate: () => void;
  quit: () => void;
}

/**
 * The application menu. Built from plain data so what it offers in each state can be tested.
 * "This app"'s update has one item, in the app menu on a Mac and in Help elsewhere; the
 * dashboard's Updates popover says the rest. macOS menus keep Title Case, as the platform expects.
 */
export const buildMenuTemplate = (
  model: MenuModel,
  actions: MenuActions,
): MenuItemConstructorOptions[] => {
  const update = updateItems(model.update, actions);
  if (model.platform === "darwin") {
    return [
      { role: "appMenu", submenu: macAppMenu(model, actions, update) },
      { label: "Host", submenu: hostMenu(model, actions) },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ];
  }
  return [
    {
      label: "File",
      submenu: [settingsItem(model, actions), { type: "separator" }, { role: "quit" }],
    },
    { label: "Host", submenu: hostMenu(model, actions) },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    { label: "Help", submenu: [{ role: "about" }, ...update] },
  ];
};

export interface AboutModel {
  appName: string;
  appVersion: string;
  platform: NodeJS.Platform;
  connection: ConnectionState;
}

/** About: the app and its version, and the host it talks to with that host's version. */
export const aboutPanelOptions = (model: AboutModel): AboutPanelOptionsOptions => {
  const host = hostLine(model.connection);
  return {
    applicationName: model.appName,
    applicationVersion: displayVersion(model.appVersion),
    credits: host,
    // Linux's panel has no credits; the copyright line is the one it shows.
    ...(model.platform === "linux" ? { copyright: host } : {}),
  };
};

/**
 * The Mac's app menu, as Electron builds it, plus the update item and Settings…, and except
 * Quit: the native item sends `terminate:` down the responder chain, and with an AOP Browser
 * page in the window it can stall halfway, the window closed and the app still running.
 * Quitting through the app itself always finishes.
 */
const macAppMenu = (
  model: MenuModel,
  actions: MenuActions,
  update: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] => [
  { role: "about" },
  ...update,
  { type: "separator" },
  settingsItem(model, actions),
  { type: "separator" },
  { role: "services" },
  { type: "separator" },
  { role: "hide" },
  { role: "hideOthers" },
  { role: "unhide" },
  { type: "separator" },
  { label: "Quit", accelerator: "Command+Q", click: actions.quit },
];

/** Restart once a build is downloaded; otherwise look now. None where the app never updates itself. */
const updateItems = (
  update: AppUpdateState,
  actions: MenuActions,
): MenuItemConstructorOptions[] => {
  switch (update.status) {
    case "off":
      return [];
    case "ready":
      return [
        {
          label: `Restart to Update (${displayVersion(update.version)})`,
          click: actions.restartToUpdate,
        },
      ];
    default:
      return [
        {
          label: "Check for Updates…",
          enabled: update.status !== "checking",
          click: actions.checkForUpdates,
        },
      ];
  }
};

/**
 * The AOP settings live in the dashboard, so they need a host to talk to. The menu takes ⌘, before
 * the page sees it, and tells the dashboard to open them.
 */
const settingsItem = (model: MenuModel, actions: MenuActions): MenuItemConstructorOptions => ({
  label: "Settings…",
  accelerator: "CommandOrControl+,",
  enabled: model.connection.status === "connected",
  click: actions.openSettings,
});

const hostMenu = (model: MenuModel, actions: MenuActions): MenuItemConstructorOptions[] => {
  const { connection } = model;
  const connected = connection.status === "connected";
  const items: MenuItemConstructorOptions[] = [
    { label: connectionLabel(connection), enabled: false },
    { type: "separator" },
    { label: "Show Dashboard", enabled: connected, click: actions.showDashboard },
    { label: "Reconnect", enabled: connection.status !== "unconfigured", click: actions.reconnect },
    { label: "Change Host…", click: actions.changeHost },
    { type: "separator" },
    { label: "Host Setup…", enabled: connected, click: actions.openHostSetup },
  ];
  if (model.hostModeAvailable) items.push({ type: "separator" }, ...hostModeItems(model, actions));
  return items;
};

const hostModeItems = (model: MenuModel, actions: MenuActions): MenuItemConstructorOptions[] => {
  const { hostProcess } = model;
  const stoppable = hostProcess.status === "running" || hostProcess.status === "starting";
  return [
    { label: "Host on This Mac…", click: actions.manageHost },
    stoppable
      ? { label: "Stop Host on This Mac", click: actions.stopHost }
      : {
          label: "Run Host on This Mac",
          enabled: hostProcess.status !== "stopping",
          click: actions.startHost,
        },
  ];
};

const hostLine = (connection: ConnectionState): string => {
  if (connection.status === "connected") {
    return `Host ${hostShortName(connection.host)} · ${displayVersion(connection.hostVersion)}`;
  }
  return connectionLabel(connection);
};
