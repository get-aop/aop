import { join } from "node:path";

interface DesktopPaths {
  preloadPath: string;
  /** The connect screen. The dashboard is a folder inside it, served as its own origin. */
  shellRoot: string;
  dashboardRoot: string;
  /** Where the Mac app keeps the host server it can run. */
  resourceRoot: string;
}

export const resolveDesktopPaths = (
  appPath: string,
  resourcesPath: string,
  development: boolean,
): DesktopPaths => ({
  preloadPath: join(appPath, "dist-electron/preload.cjs"),
  shellRoot: join(appPath, "dist"),
  dashboardRoot: join(appPath, "dist/dashboard"),
  resourceRoot: development ? join(appPath, "resources") : resourcesPath,
});
