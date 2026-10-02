import type { MenuItemConstructorOptions } from "electron";
import { connectionLabel } from "../src/backend/connection-label";
import { hostVersionNotice } from "../src/backend/host-version";
import type { AppUpdateState, ConnectionState, HostProcessState } from "../src/backend/types";
import { updateLabel } from "../src/backend/update-label";

export interface MenuModel {
  platform: NodeJS.Platform;
  connection: ConnectionState;
  hostProcess: HostProcessState;
  hostModeAvailable: boolean;
  update: AppUpdateState;
  appVersion: string;
}

export interface MenuActions {
  showDashboard: () => void;
  reconnect: () => void;
  changeHost: () => void;
  manageHost: () => void;
  startHost: () => void;
  stopHost: () => void;
  openUpdateDownload: () => void;
  restartToUpdate: () => void;
  quit: () => void;
}

/** The application menu. Built from plain data so what it offers in each state can be tested. */
export const buildMenuTemplate = (
  model: MenuModel,
  actions: MenuActions,
): MenuItemConstructorOptions[] => [
  ...(model.platform === "darwin"
    ? [{ role: "appMenu" as const, submenu: macAppMenu(actions) }]
    : [{ label: "File", submenu: [{ role: "quit" as const }] }]),
  { label: "Host", submenu: hostMenu(model, actions) },
  ...updateMenu(model.update, actions),
  { role: "editMenu" },
  { role: "viewMenu" },
  { role: "windowMenu" },
];

/**
 * The Mac's app menu, as Electron builds it, except Quit: the native item sends `terminate:` down
 * the responder chain, and with an AOP Browser page in the window it can stall halfway, the
 * window closed and the app still running. Quitting through the app itself always finishes.
 */
const macAppMenu = (actions: MenuActions): MenuItemConstructorOptions[] => [
  { role: "about" },
  { type: "separator" },
  { role: "services" },
  { type: "separator" },
  { role: "hide" },
  { role: "hideOthers" },
  { role: "unhide" },
  { type: "separator" },
  { label: "Quit", accelerator: "Command+Q", click: actions.quit },
];

const hostMenu = (model: MenuModel, actions: MenuActions): MenuItemConstructorOptions[] => {
  const { connection } = model;
  const items: MenuItemConstructorOptions[] = [
    { label: connectionLabel(connection), enabled: false },
    ...hostVersionItems(model),
    { type: "separator" },
    {
      label: "Show Dashboard",
      enabled: connection.status === "connected",
      click: actions.showDashboard,
    },
    { label: "Reconnect", enabled: connection.status !== "unconfigured", click: actions.reconnect },
    { label: "Change Host…", click: actions.changeHost },
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

// A host on another release than the app is a notice, not a fault: the API handshake decides
// whether they can talk.
const hostVersionItems = (model: MenuModel): MenuItemConstructorOptions[] => {
  if (model.connection.status !== "connected") return [];
  const notice = hostVersionNotice(model.connection.hostVersion, model.appVersion);
  return notice ? [{ label: notice, enabled: false }] : [];
};

/** A menu that exists only while the app has an update to offer, so it stays out of the way otherwise. */
const updateMenu = (update: AppUpdateState, actions: MenuActions): MenuItemConstructorOptions[] => {
  const label = updateLabel(update);
  if (!label) return [];
  switch (update.status) {
    case "available":
      return [
        {
          label,
          submenu: [{ label: `Download ${update.version}…`, click: actions.openUpdateDownload }],
        },
      ];
    case "downloading":
      return [{ label, submenu: [{ label: `Downloading… ${update.percent}%`, enabled: false }] }];
    case "ready":
      return [{ label, submenu: [{ label: "Restart to Update", click: actions.restartToUpdate }] }];
    case "idle":
      return [];
  }
};
