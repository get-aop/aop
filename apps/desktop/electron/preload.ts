import { contextBridge, ipcRenderer } from "electron";
import { createDesktopBridge } from "./bridge";

contextBridge.exposeInMainWorld(
  "aopDesktop",
  createDesktopBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, listener) => {
      const handler = (_event: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, handler);
      return () => void ipcRenderer.removeListener(channel, handler);
    },
  ),
);
