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
    webviewTag: true;
    /** Chromium's built-in PDF viewer, which the artifact view shows PDFs in. */
    plugins: true;
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
    // The AOP Browser's pages are <webview> guests of the dashboard. The browser host refuses any
    // guest that is not on the browser's partition, and pins each one sandboxed with no preload.
    webviewTag: true,
    plugins: true,
  },
});
