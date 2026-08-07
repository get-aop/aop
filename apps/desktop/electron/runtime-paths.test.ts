import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveDesktopPaths } from "./runtime-paths";

describe("Electron runtime paths", () => {
  test("resolves packaged files from app.asar instead of the source checkout", () => {
    const appPath = "/Applications/AOP.app/Contents/Resources/app.asar";
    const resourcesPath = "/Applications/AOP.app/Contents/Resources";

    expect(resolveDesktopPaths(appPath, resourcesPath, false)).toEqual({
      preloadPath: join(appPath, "dist-electron/preload.cjs"),
      rendererRoot: join(appPath, "dist"),
      resourceRoot: resourcesPath,
    });
  });

  test("resolves development files from the desktop workspace", () => {
    const appPath = "/repo/apps/desktop";

    expect(resolveDesktopPaths(appPath, "/unused", true)).toEqual({
      preloadPath: join(appPath, "dist-electron/preload.cjs"),
      rendererRoot: join(appPath, "dist"),
      resourceRoot: join(appPath, "resources"),
    });
  });
});
