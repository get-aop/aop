import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveDesktopPaths } from "./runtime-paths";

describe("resolveDesktopPaths", () => {
  test("serves the dashboard from a folder inside the connect screen's build", () => {
    const paths = resolveDesktopPaths("/app", "/Resources", false);

    expect(paths.shellRoot).toBe(join("/app", "dist"));
    expect(paths.dashboardRoot).toBe(join("/app", "dist", "dashboard"));
    expect(paths.preloadPath).toBe(join("/app", "dist-electron", "preload.cjs"));
  });

  test("looks for the host server in the app's resources when packaged, and beside the source in development", () => {
    expect(resolveDesktopPaths("/app", "/Resources", false).resourceRoot).toBe("/Resources");
    expect(resolveDesktopPaths("/app", "/Resources", true).resourceRoot).toBe(
      join("/app", "resources"),
    );
  });
});
