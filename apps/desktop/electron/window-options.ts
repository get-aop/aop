export interface DesktopWindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  title: string;
  backgroundColor: string;
  webPreferences: {
    preload: string;
    contextIsolation: true;
    nodeIntegration: false;
    sandbox: true;
    webviewTag: false;
  };
}

export const buildWindowOptions = (preloadPath: string): DesktopWindowOptions => ({
  width: 1280,
  height: 860,
  minWidth: 960,
  minHeight: 640,
  show: false,
  title: "AOP",
  backgroundColor: "#0b0d10",
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
  },
});
