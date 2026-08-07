#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: packaging helper reports progress to release logs

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import cac from "cac";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_RELEASE_DIR = "dist/release";
const MAC_ARCHES = ["x64", "arm64"] as const;

export type MacArch = (typeof MAC_ARCHES)[number];
export type DesktopPlatform = "darwin" | "windows";

export interface ElectronResourcePlan {
  arch: MacArch;
  binaryPath: string;
  platform: DesktopPlatform;
  resourcesDir: string;
  runtimeAssetsArchive: string;
  runtimeAssetsResource?: string;
  runtimeFingerprintResource?: string;
  sidecarPath: string;
}

interface ResourcePlanOptions {
  arch: MacArch;
  platform?: DesktopPlatform;
  releaseDir?: string;
  workspaceRoot?: string;
}

interface CliOptions {
  arch?: string;
  platform?: string;
  "release-dir"?: string;
}

export const buildElectronResourcePlan = ({
  arch,
  platform = "darwin",
  releaseDir = DEFAULT_RELEASE_DIR,
  workspaceRoot = WORKSPACE_ROOT,
}: ResourcePlanOptions): ElectronResourcePlan => {
  const root = resolve(workspaceRoot);
  const resolvedReleaseDir = isAbsolute(releaseDir) ? releaseDir : join(root, releaseDir);
  const resourcesDir = join(root, "apps/desktop/resources");
  const windows = platform === "windows";
  return {
    arch,
    binaryPath: join(resolvedReleaseDir, windows ? "aop-linux-x64" : `aop-darwin-${arch}`),
    platform,
    resourcesDir,
    runtimeAssetsArchive: join(resolvedReleaseDir, "runtime-assets.tar.gz"),
    ...(windows
      ? {
          runtimeAssetsResource: join(resourcesDir, "runtime-assets.tar.gz"),
          runtimeFingerprintResource: join(resourcesDir, "desktop-runtime.sha256"),
        }
      : {}),
    sidecarPath: join(resourcesDir, windows ? "aop-linux-x64" : "aop"),
  };
};

export const prepareElectronResources = async (plan: ElectronResourcePlan): Promise<void> => {
  await assertFile(plan.binaryPath, `Sidecar binary not found: ${plan.binaryPath}`);
  await assertFile(
    plan.runtimeAssetsArchive,
    `Runtime assets archive not found: ${plan.runtimeAssetsArchive}`,
  );
  await rm(plan.resourcesDir, { force: true, recursive: true });
  await mkdir(plan.resourcesDir, { recursive: true });
  await writeFile(join(plan.resourcesDir, ".gitkeep"), "");
  await cp(plan.binaryPath, plan.sidecarPath);

  if (plan.platform === "windows") {
    const assets = requiredPath(plan.runtimeAssetsResource, "Windows runtime assets resource");
    const fingerprint = requiredPath(
      plan.runtimeFingerprintResource,
      "Windows runtime fingerprint resource",
    );
    await cp(plan.runtimeAssetsArchive, assets);
    await writeFile(
      fingerprint,
      `${await hashFiles([plan.binaryPath, plan.runtimeAssetsArchive])}\n`,
    );
  } else {
    await chmod(plan.sidecarPath, 0o755);
    await Bun.$`tar -xzf ${plan.runtimeAssetsArchive} -C ${plan.resourcesDir}`.quiet();
  }

  const label = plan.platform === "windows" ? "Windows x64 WSL" : `macOS ${plan.arch}`;
  console.log(`Prepared Electron resources for ${label}`);
};

const hashFiles = async (paths: string[]): Promise<string> => {
  const hash = createHash("sha256");
  for (const [index, path] of paths.entries()) {
    const file = await stat(path);
    hash.update(`aop-desktop-runtime:${index}:${file.size}\0`);
    await new Promise<void>((resolveStream, reject) => {
      const stream = createReadStream(path);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", resolveStream);
    });
  }
  return hash.digest("hex");
};

const assertFile = async (path: string, message: string): Promise<void> => {
  try {
    await stat(path);
  } catch {
    throw new Error(message);
  }
};

const requiredPath = (path: string | undefined, label: string): string => {
  if (!path) throw new Error(`${label} is missing.`);
  return path;
};

const parseArch = (value: string | undefined): MacArch => {
  if (!value) return "arm64";
  if (MAC_ARCHES.includes(value as MacArch)) return value as MacArch;
  throw new Error(`Unknown macOS arch "${value}". Use x64 or arm64.`);
};

const parsePlatform = (value: string | undefined): DesktopPlatform => {
  if (!value || value === "darwin") return "darwin";
  if (value === "windows") return "windows";
  throw new Error(`Unknown platform "${value}". Use darwin or windows.`);
};

const main = async (): Promise<void> => {
  const cli = cac("prepare-electron-resources");
  cli
    .option("--arch <arch>", "macOS architecture to prepare", { default: "arm64" })
    .option("--platform <platform>", "Target platform", { default: "darwin" })
    .option("--release-dir <path>", "Release artifact directory", {
      default: DEFAULT_RELEASE_DIR,
    });
  const { options } = cli.parse();
  const values = options as CliOptions;
  await prepareElectronResources(
    buildElectronResourcePlan({
      arch: parseArch(values.arch),
      platform: parsePlatform(values.platform),
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
