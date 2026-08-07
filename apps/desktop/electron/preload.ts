import { contextBridge, ipcRenderer } from "electron";
import { createDesktopBridge } from "./bridge";

contextBridge.exposeInMainWorld(
  "aopDesktop",
  createDesktopBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
);
