#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release packaging CLI reports progress to the operator

import { cp, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import cac from "cac";
import {
  buildElectronResourcePlan,
  prepareElectronResources,
} from "../desktop/prepare-electron-resources";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_RELEASE_DIR = "dist/release";
const INSTALLER_NAME = "aop-windows-x64-setup.exe";

export interface WindowsInstallerPlan {
  appName: string;
  builderInstallerPath: string;
  builderOutputDir: string;
  installerPath: string;
  releaseDir: string;
  resourcesDir: string;
  runtimeAssetsArchive: string;
  version: string;
  workspaceRoot: string;
}

export type WindowsSigningConfig =
  | { mode: "unsigned" }
  | { mode: "signed"; pfxBase64: string; password: string };

interface BuildWindowsInstallerPlanOptions {
  releaseDir?: string;
  version: string;
  workspaceRoot?: string;
}

interface BuildWindowsInstallerArtifactsOptions {
  releaseDir?: string;
  signingConfig?: WindowsSigningConfig;
  version?: string;
  workspaceRoot?: string;
}

interface CliOptions {
  "release-dir"?: string;
  version?: string;
}

export const resolveWindowsInstallerArtifacts = (): string[] => [INSTALLER_NAME];

export const buildWindowsInstallerPlan = ({
  releaseDir = DEFAULT_RELEASE_DIR,
  version,
  workspaceRoot = WORKSPACE_ROOT,
}: BuildWindowsInstallerPlanOptions): WindowsInstallerPlan => {
  const root = resolve(workspaceRoot);
  const resolvedReleaseDir = isAbsolute(releaseDir) ? releaseDir : join(root, releaseDir);
  const builderOutputDir = join(root, "dist/electron-builder");
  return {
    appName: "AOP",
    builderInstallerPath: join(builderOutputDir, INSTALLER_NAME),
    builderOutputDir,
    installerPath: join(resolvedReleaseDir, INSTALLER_NAME),
    releaseDir: resolvedReleaseDir,
    resourcesDir: join(root, "apps/desktop/resources"),
    runtimeAssetsArchive: join(resolvedReleaseDir, "runtime-assets.tar.gz"),
    version,
    workspaceRoot: root,
  };
};

export const parseWindowsSigningConfig = (
  env: Partial<Record<string, string | undefined>> = process.env,
): WindowsSigningConfig => {
  const pfxBase64 = env.AOP_WINDOWS_PFX_BASE64?.trim();
  if (!pfxBase64) return { mode: "unsigned" };
  const password = env.AOP_WINDOWS_PFX_PASSWORD?.trim();
  if (!password) throw new Error("AOP_WINDOWS_PFX_BASE64 requires AOP_WINDOWS_PFX_PASSWORD");
  return { mode: "signed", pfxBase64, password };
};

export const electronBuilderWindowsSigningEnv = (
  signingConfig: WindowsSigningConfig,
): Record<string, string> =>
  signingConfig.mode === "unsigned"
    ? { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
    : {
        WIN_CSC_LINK: signingConfig.pfxBase64,
        WIN_CSC_KEY_PASSWORD: signingConfig.password,
      };

export const buildWindowsInstallerArtifacts = async ({
  releaseDir = DEFAULT_RELEASE_DIR,
  signingConfig = parseWindowsSigningConfig(),
  version,
  workspaceRoot = WORKSPACE_ROOT,
}: BuildWindowsInstallerArtifactsOptions = {}): Promise<string[]> => {
  ensureWindowsHost();
  const buildVersion = version ?? (await readPackageVersion(workspaceRoot));
  const plan = buildWindowsInstallerPlan({ releaseDir, version: buildVersion, workspaceRoot });
  await prepareElectronResources(
    buildElectronResourcePlan({
      arch: "x64",
      platform: "windows",
      releaseDir: plan.releaseDir,
      workspaceRoot: plan.workspaceRoot,
    }),
  );
  await runCommand(["bun", "run", "--filter", "@aop/desktop", "build"], plan.workspaceRoot);
  await runCommand(
    [
      "bunx",
      "electron-builder",
      "--config",
      join(plan.workspaceRoot, "scripts/desktop/electron-builder-config.ts"),
      "--projectDir",
      plan.workspaceRoot,
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never",
    ],
    plan.workspaceRoot,
    electronBuilderWindowsSigningEnv(signingConfig),
  );
  await assertFile(
    plan.builderInstallerPath,
    "Electron Builder did not produce the expected Windows installer.",
  );
  await cp(plan.builderInstallerPath, plan.installerPath);
  console.log(`Built ${plan.installerPath}`);
  return [plan.installerPath];
};

const readPackageVersion = async (workspaceRoot: string): Promise<string> => {
  const packageJson = await Bun.file(join(workspaceRoot, "package.json")).json();
  return String(packageJson.version);
};

const ensureWindowsHost = (): void => {
  if (process.platform !== "win32") {
    throw new Error("Windows installer packaging requires a Windows host with NSIS");
  }
};

const assertFile = async (path: string, message: string): Promise<void> => {
  try {
    await stat(path);
  } catch {
    throw new Error(message);
  }
};

const runCommand = async (
  command: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<void> => {
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
};

const main = async (): Promise<void> => {
  const cli = cac("windows-installer");
  cli
    .option("--release-dir <path>", "Release artifact directory", {
      default: DEFAULT_RELEASE_DIR,
    })
    .option("--version <version>", "Version label for the installer");
  const { options } = cli.parse();
  const values = options as CliOptions;
  await buildWindowsInstallerArtifacts({
    releaseDir: values["release-dir"],
    version: values.version,
  });
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
