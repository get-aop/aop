import { join } from "node:path";

interface DesktopPaths {
  preloadPath: string;
  rendererRoot: string;
  resourceRoot: string;
}

export const resolveDesktopPaths = (
  appPath: string,
  resourcesPath: string,
  development: boolean,
): DesktopPaths => ({
  preloadPath: join(appPath, "dist-electron/preload.cjs"),
  rendererRoot: join(appPath, "dist"),
  resourceRoot: development ? join(appPath, "resources") : resourcesPath,
});
