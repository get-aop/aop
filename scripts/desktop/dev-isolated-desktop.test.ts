import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildIsolatedDesktopDevPlan, buildWrapperScript } from "./dev-isolated-desktop.ts";

describe("buildIsolatedDesktopDevPlan", () => {
  test("uses isolated desktop app ports and storage by default", () => {
    const plan = buildIsolatedDesktopDevPlan({
      homeDir: "/Users/tester",
      workspaceRoot: "/repo",
    });

    expect(plan.localServerPort).toBe(25360);
    expect(plan.dashboardPort).toBe(25370);
    expect(plan.aopHome).toBe(join("/Users/tester", ".aop-local-dev", "desktop-app"));
    expect(plan.dbPath).toBe(join(plan.aopHome, "aop.sqlite"));
    expect(plan.wrapperPath).toBe(join(plan.aopHome, "bin", "aop-dev-sidecar"));
    expect(plan.env.AOP_DESKTOP_SIDECAR_PATH).toBe(plan.wrapperPath);
    expect(plan.env.AOP_DESKTOP_LOCAL_SERVER_PORT).toBe("25360");
    expect(plan.env.AOP_DESKTOP_DASHBOARD_PORT).toBe("25370");
    expect(plan.env.AOP_DESKTOP_DASHBOARD_DEV).toBe("1");
    expect(plan.env.AOP_LOCAL_SERVER_URL).toBe("http://127.0.0.1:25360");
    expect(plan.env.AOP_TEST_MODE).toBe("false");
  });

  test("allows explicit ports for local debugging", () => {
    const plan = buildIsolatedDesktopDevPlan({
      dashboardPort: 26270,
      homeDir: "/Users/tester",
      localServerPort: 26260,
      workspaceRoot: "/repo",
    });

    expect(plan.localServerPort).toBe(26260);
    expect(plan.dashboardPort).toBe(26270);
    expect(plan.env.AOP_DESKTOP_LOCAL_SERVER_PORT).toBe("26260");
    expect(plan.env.AOP_DESKTOP_DASHBOARD_PORT).toBe("26270");
  });

  test("prints sidecar version directly so the desktop probe exits", () => {
    const wrapper = buildWrapperScript("/repo", "1.2.3");

    expect(wrapper).toContain('if [[ "$' + '{1:-}" == "--version" ]]');
    expect(wrapper).toContain("echo 'aop/1.2.3 darwin-arm64 dev-sidecar'");
    expect(wrapper).toContain("exit 0");
    expect(wrapper).toContain('if [[ "$' + '{1:-}" == "run" ]]');
    expect(wrapper).toContain("exec bun run dev");
  });
});
