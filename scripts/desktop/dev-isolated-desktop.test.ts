import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildIsolatedDesktopDevPlan, buildWrapperScript } from "./dev-isolated-desktop.ts";

describe("buildIsolatedDesktopDevPlan", () => {
  test("uses its own port and storage, so it never touches a released AOP", () => {
    const plan = buildIsolatedDesktopDevPlan({
      homeDir: "/Users/tester",
      workspaceRoot: "/repo",
    });

    expect(plan.localServerPort).toBe(25360);
    expect(plan.aopHome).toBe(join("/Users/tester", ".aop-local-dev", "desktop-app"));
    expect(plan.dbPath).toBe(join(plan.aopHome, "projects.sqlite"));
    expect(plan.wrapperPath).toBe(join(plan.aopHome, "bin", "aop-dev-host"));
    expect(plan.env.AOP_DESKTOP_HOST_PATH).toBe(plan.wrapperPath);
    expect(plan.env.AOP_DESKTOP_LOCAL_SERVER_PORT).toBe("25360");
    expect(plan.env.AOP_HOME).toBe(plan.aopHome);
    expect(plan.env.AOP_DB_PATH).toBe(plan.dbPath);
  });

  test("allows an explicit port for local debugging", () => {
    const plan = buildIsolatedDesktopDevPlan({
      homeDir: "/Users/tester",
      localServerPort: 26260,
      workspaceRoot: "/repo",
    });

    expect(plan.localServerPort).toBe(26260);
    expect(plan.env.AOP_DESKTOP_LOCAL_SERVER_PORT).toBe("26260");
  });
});

describe("buildWrapperScript", () => {
  test("starts this checkout's server when the app runs it, and the CLI for anything else", () => {
    const wrapper = buildWrapperScript("/repo");

    expect(wrapper).toContain("cd '/repo'");
    expect(wrapper).toContain('if [[ "$' + '{1:-}" == "run" ]]');
    expect(wrapper).toContain("exec bun run apps/local-server/src/run.ts");
    expect(wrapper).toContain('exec bun run apps/cli/src/main.ts "$@"');
  });

  test("does not start the dashboard dev server: the app bundles its own dashboard", () => {
    expect(buildWrapperScript("/repo")).not.toContain("bun run dev");
  });
});
