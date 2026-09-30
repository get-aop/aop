import type { MenuItemConstructorOptions } from "electron";
import { connectionLabel } from "../src/backend/connection-label";
import type { ConnectionState, HostProcessState } from "../src/backend/types";

export interface MenuModel {
  platform: NodeJS.Platform;
  connection: ConnectionState;
  hostProcess: HostProcessState;
  hostModeAvailable: boolean;
}

export interface MenuActions {
  showDashboard: () => void;
  reconnect: () => void;
  changeHost: () => void;
  manageHost: () => void;
  startHost: () => void;
  stopHost: () => void;
}

/** The application menu. Built from plain data so what it offers in each state can be tested. */
export const buildMenuTemplate = (
  model: MenuModel,
  actions: MenuActions,
): MenuItemConstructorOptions[] => [
  ...(model.platform === "darwin"
    ? [{ role: "appMenu" as const }]
    : [{ label: "File", submenu: [{ role: "quit" as const }] }]),
  { label: "Host", submenu: hostMenu(model, actions) },
  { role: "editMenu" },
  { role: "viewMenu" },
  { role: "windowMenu" },
];

const hostMenu = (model: MenuModel, actions: MenuActions): MenuItemConstructorOptions[] => {
  const { connection } = model;
  const items: MenuItemConstructorOptions[] = [
    { label: connectionLabel(connection), enabled: false },
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
