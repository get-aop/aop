#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: development launcher reports child-process status

import { join, resolve } from "node:path";
import { buildElectronBundles } from "./build-electron";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DESKTOP_URL = "http://127.0.0.1:25170";

export const buildElectronDevPlan = (workspaceRoot = WORKSPACE_ROOT) => {
  const root = resolve(workspaceRoot);
  return {
    electronCommand: [
      join(root, "apps/desktop/node_modules/.bin/electron"),
      join(root, "apps/desktop"),
    ],
    electronEnv: { AOP_DESKTOP_DEV_URL: DESKTOP_URL },
    rendererCommand: ["bun", "run", "--filter", "@aop/desktop", "dev"],
    workspaceRoot: root,
  };
};

const main = async (): Promise<void> => {
  const plan = buildElectronDevPlan();
  await buildElectronBundles(plan.workspaceRoot);
  const renderer = Bun.spawn(plan.rendererCommand, {
    cwd: plan.workspaceRoot,
    env: process.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  await waitForRenderer();

  const electron = Bun.spawn(plan.electronCommand, {
    cwd: plan.workspaceRoot,
    env: { ...process.env, ...plan.electronEnv },
    stderr: "inherit",
    stdout: "inherit",
  });
  const stop = (): void => {
    electron.kill();
    renderer.kill();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const exitCode = await electron.exited;
  renderer.kill();
  await renderer.exited;
  process.exitCode = exitCode;
};

const waitForRenderer = async (): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(DESKTOP_URL);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Desktop renderer did not start at ${DESKTOP_URL}.`);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
