import { describe, expect, test } from "bun:test";
import { buildElectronDevPlan } from "./dev-electron";

describe("Electron desktop development", () => {
  test("starts Vite and Electron against the fixed desktop URL", () => {
    expect(buildElectronDevPlan("/repo")).toEqual({
      electronCommand: ["/repo/apps/desktop/node_modules/.bin/electron", "/repo/apps/desktop"],
      electronEnv: { AOP_DESKTOP_DEV_URL: "http://127.0.0.1:25170" },
      rendererCommand: ["bun", "run", "--filter", "@aop/desktop", "dev"],
      workspaceRoot: "/repo",
    });
  });
});
