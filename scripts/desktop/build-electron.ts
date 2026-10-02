#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: desktop build helper reports bundler failures

import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { channelDefine, parseReleaseChannel } from "@aop/common";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");

export const buildElectronBundlePlan = (
  workspaceRoot = WORKSPACE_ROOT,
  channel = parseReleaseChannel(process.env.AOP_BUILD_CHANNEL),
) => {
  const root = resolve(workspaceRoot);
  return {
    // AOP_BUILD_CHANNEL=nightly makes AOP Nightly (docs/NIGHTLY.md).
    define: channelDefine(channel),
    entrypoints: [
      join(root, "apps/desktop/electron/main.ts"),
      join(root, "apps/desktop/electron/preload.ts"),
    ],
    external: ["electron"],
    format: "cjs" as const,
    naming: "[name].cjs",
    outdir: join(root, "apps/desktop/dist-electron"),
    sourcemap: "external" as const,
    target: "node" as const,
  };
};

export const buildElectronBundles = async (workspaceRoot = WORKSPACE_ROOT): Promise<void> => {
  const plan = buildElectronBundlePlan(workspaceRoot);
  await rm(plan.outdir, { force: true, recursive: true });
  const result = await Bun.build(plan);
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Electron main-process bundle failed.");
  }
};

if (import.meta.main) {
  buildElectronBundles().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
