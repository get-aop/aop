#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: packaging helper reports progress to release logs

import { chmod, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import cac from "cac";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_RELEASE_DIR = "dist/release";
const MAC_ARCHES = ["x64", "arm64"] as const;

export type MacArch = (typeof MAC_ARCHES)[number];

/**
 * What the Mac app carries so it can run the host on its own Mac: the `aop` server and the
 * dashboard files it serves to browsers. Windows is a client only and carries neither.
 */
export interface ElectronResourcePlan {
  arch: MacArch;
  binaryPath: string;
  resourcesDir: string;
  runtimeAssetsArchive: string;
  hostServerPath: string;
}

interface ResourcePlanOptions {
  arch: MacArch;
  releaseDir?: string;
  workspaceRoot?: string;
}

interface CliOptions {
  arch?: string;
  "release-dir"?: string;
}

export const buildElectronResourcePlan = ({
  arch,
  releaseDir = DEFAULT_RELEASE_DIR,
  workspaceRoot = WORKSPACE_ROOT,
}: ResourcePlanOptions): ElectronResourcePlan => {
  const root = resolve(workspaceRoot);
  const resolvedReleaseDir = isAbsolute(releaseDir) ? releaseDir : join(root, releaseDir);
  const resourcesDir = join(root, "apps/desktop/resources");
  return {
    arch,
    binaryPath: join(resolvedReleaseDir, `aop-darwin-${arch}`),
    resourcesDir,
    runtimeAssetsArchive: join(resolvedReleaseDir, "runtime-assets.tar.gz"),
    hostServerPath: join(resourcesDir, "aop"),
  };
};

export const prepareElectronResources = async (plan: ElectronResourcePlan): Promise<void> => {
  await assertFile(plan.binaryPath, `Host server binary not found: ${plan.binaryPath}`);
  await assertFile(
    plan.runtimeAssetsArchive,
    `Runtime assets archive not found: ${plan.runtimeAssetsArchive}`,
  );
  await rm(plan.resourcesDir, { force: true, recursive: true });
  await mkdir(plan.resourcesDir, { recursive: true });
  await writeFile(join(plan.resourcesDir, ".gitkeep"), "");
  await cp(plan.binaryPath, plan.hostServerPath);
  await chmod(plan.hostServerPath, 0o755);
  await Bun.$`tar -xzf ${plan.runtimeAssetsArchive} -C ${plan.resourcesDir}`.quiet();
  console.log(`Prepared Electron resources for macOS ${plan.arch}`);
};

const assertFile = async (path: string, message: string): Promise<void> => {
  try {
    await stat(path);
  } catch {
    throw new Error(message);
  }
};

const parseArch = (value: string | undefined): MacArch => {
  if (!value) return "arm64";
  if (MAC_ARCHES.includes(value as MacArch)) return value as MacArch;
  throw new Error(`Unknown macOS arch "${value}". Use x64 or arm64.`);
};

const main = async (): Promise<void> => {
  const cli = cac("prepare-electron-resources");
  cli
    .option("--arch <arch>", "macOS architecture to prepare", { default: "arm64" })
    .option("--release-dir <path>", "Release artifact directory", {
      default: DEFAULT_RELEASE_DIR,
    });
  const { options } = cli.parse();
  const values = options as CliOptions;
  await prepareElectronResources(
    buildElectronResourcePlan({
      arch: parseArch(values.arch),
      releaseDir: values["release-dir"],
    }),
  );
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
