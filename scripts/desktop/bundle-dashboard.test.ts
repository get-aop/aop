import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleDashboard } from "./bundle-dashboard";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const workspace = async (dashboardFiles: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), "aop-bundle-dashboard-"));
  roots.push(root);
  const dist = join(root, "apps/dashboard/dist");
  await mkdir(dist, { recursive: true });
  for (const [name, content] of Object.entries(dashboardFiles)) {
    await writeFile(join(dist, name), content);
  }
  return root;
};

const bundled = (root: string) => join(root, "apps/desktop/dist/dashboard");

describe("bundleDashboard", () => {
  test("builds the dashboard and copies it into the desktop app's build folder", async () => {
    const root = await workspace({
      "index.html": "<html>dashboard</html>",
      "main-abc123.js": "console.log(1)",
      "index.css": "body{}",
    });
    const builds: string[] = [];

    const destination = await bundleDashboard({
      workspaceRoot: root,
      buildDashboard: async (workspaceRoot) => void builds.push(workspaceRoot),
    });

    expect(builds).toEqual([root]);
    expect(destination).toBe(bundled(root));
    expect((await readdir(destination)).sort()).toEqual([
      "index.css",
      "index.html",
      "main-abc123.js",
    ]);
    expect(await readFile(join(destination, "index.html"), "utf8")).toBe("<html>dashboard</html>");
  });

  test("leaves the source maps out, which are most of the size and useless in the app", async () => {
    const root = await workspace({
      "index.html": "<html></html>",
      "main-abc123.js": "1",
      "main-abc123.js.map": "{}",
    });

    await bundleDashboard({ workspaceRoot: root, buildDashboard: async () => {} });

    expect(await readdir(bundled(root))).not.toContain("main-abc123.js.map");
  });

  test("replaces the last bundle, so a file the dashboard no longer builds does not linger", async () => {
    const root = await workspace({ "index.html": "<html></html>" });
    await mkdir(bundled(root), { recursive: true });
    await writeFile(join(bundled(root), "main-old.js"), "stale");

    await bundleDashboard({ workspaceRoot: root, buildDashboard: async () => {} });

    expect(await readdir(bundled(root))).toEqual(["index.html"]);
  });

  test("fails loudly when the dashboard build produced no page, instead of shipping an empty app", async () => {
    const root = await workspace({});

    await expect(
      bundleDashboard({ workspaceRoot: root, buildDashboard: async () => {} }),
    ).rejects.toThrow("left no index.html");
  });

  test("does not swallow a failed build", async () => {
    const root = await workspace({ "index.html": "<html></html>" });

    await expect(
      bundleDashboard({
        workspaceRoot: root,
        buildDashboard: async () => {
          throw new Error("The dashboard build failed.");
        },
      }),
    ).rejects.toThrow("The dashboard build failed.");
  });
});
