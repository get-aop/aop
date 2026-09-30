#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: desktop build helper reports what it bundled

import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");

interface BundleOptions {
  workspaceRoot?: string;
  /** Builds the dashboard; a test passes a stand-in. */
  buildDashboard?: (workspaceRoot: string) => Promise<void>;
}

/**
 * Puts a fresh build of the dashboard inside the desktop app, where the app serves it as
 * `app://aop`. It goes in the desktop screen's own build folder, so electron-builder packages it
 * with no change to its file list. Source maps stay behind: the app does not need them and
 * they are most of the size.
 */
export const bundleDashboard = async ({
  workspaceRoot = WORKSPACE_ROOT,
  buildDashboard = runDashboardBuild,
}: BundleOptions = {}): Promise<string> => {
  const root = resolve(workspaceRoot);
  const source = join(root, "apps/dashboard/dist");
  const destination = join(root, "apps/desktop/dist/dashboard");

  await buildDashboard(root);
  if (!existsSync(join(source, "index.html"))) {
    throw new Error(`The dashboard build left no index.html in ${source}.`);
  }

  // A file the dashboard no longer builds must not linger from the last bundle.
  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, filter: (path) => !path.endsWith(".map") });
  return destination;
};

const runDashboardBuild = async (workspaceRoot: string): Promise<void> => {
  const build = Bun.spawn(["bun", "run", "--filter", "@aop/dashboard", "build"], {
    cwd: workspaceRoot,
    stdout: "ignore",
    stderr: "inherit",
  });
  if ((await build.exited) !== 0) throw new Error("The dashboard build failed.");
};

if (import.meta.main) {
  bundleDashboard()
    .then((destination) => console.log(`Bundled the dashboard into ${destination}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
