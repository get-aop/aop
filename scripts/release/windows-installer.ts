#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release packaging CLI reports progress to the operator

import { cp, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import cac from "cac";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_RELEASE_DIR = "dist/release";
const INSTALLER_NAME = "aop-windows-x64-setup.exe";
// What electron-updater reads from the GitHub Release to update an installed Windows app:
// `latest.yml` names the installer and its sha512, the blockmap lets it download only the changes.
const UPDATE_INFO_NAME = "latest.yml";
const BLOCKMAP_NAME = `${INSTALLER_NAME}.blockmap`;

export interface WindowsInstallerPlan {
  appName: string;
  builderInstallerPath: string;
  builderOutputDir: string;
  /** The installer, then the updater files that travel with it, as electron-builder wrote them and as released. */
  artifacts: { name: string; builderPath: string; releasePath: string }[];
  installerPath: string;
  releaseDir: string;
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

export const resolveWindowsInstallerArtifacts = (): string[] => [
  INSTALLER_NAME,
  UPDATE_INFO_NAME,
  BLOCKMAP_NAME,
];

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
    artifacts: resolveWindowsInstallerArtifacts().map((name) => ({
      name,
      builderPath: join(builderOutputDir, name),
      releasePath: join(resolvedReleaseDir, name),
    })),
    installerPath: join(resolvedReleaseDir, INSTALLER_NAME),
    releaseDir: resolvedReleaseDir,
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
  // Windows is a client: the app bundles its own dashboard and carries no server or WSL runtime.
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
  for (const artifact of plan.artifacts) {
    await assertFile(
      artifact.builderPath,
      `Electron Builder did not produce ${artifact.name}; the installed app cannot update without it.`,
    );
    await cp(artifact.builderPath, artifact.releasePath);
    console.log(`Built ${artifact.releasePath}`);
  }
  return plan.artifacts.map((artifact) => artifact.releasePath);
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
