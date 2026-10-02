#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release packaging CLI reports progress to the operator

import { cp, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import cac from "cac";
import {
  buildElectronResourcePlan,
  prepareElectronResources,
} from "../desktop/prepare-electron-resources";
import { MAC_ARCHES, type MacArch, macUpdateZipName, writeLatestMacYml } from "./macos-updater";

export type { MacArch } from "./macos-updater";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_RELEASE_DIR = "dist/release";

export interface MacDmgPlan {
  appName: string;
  arch: MacArch;
  binaryPath: string;
  builderDmgPath: string;
  builderOutputDir: string;
  /** The zip of the app the installed macOS app updates itself from (macos-updater.ts). */
  builderZipPath: string;
  dmgPath: string;
  releaseDir: string;
  resourcesDir: string;
  runtimeAssetsArchive: string;
  version: string;
  volumeName: string;
  workspaceRoot: string;
  zipPath: string;
}

export type MacSigningConfig =
  | { mode: "unsigned" }
  | {
      mode: "signed";
      identity: string;
      notarization:
        | { enabled: false }
        | {
            enabled: true;
            appleId: string;
            appSpecificPassword: string;
            teamId: string;
          };
    };

interface BuildMacDmgPlanOptions {
  arch: MacArch;
  releaseDir?: string;
  version: string;
  workspaceRoot?: string;
}

interface BuildMacDmgArtifactsOptions {
  arch?: MacArch;
  releaseDir?: string;
  signingConfig?: MacSigningConfig;
  version?: string;
  workspaceRoot?: string;
}

interface CliOptions {
  arch?: string;
  "release-dir"?: string;
  version?: string;
}

export const resolveMacDmgArtifacts = (): string[] =>
  MAC_ARCHES.map((arch) => `aop-macos-${arch}.dmg`);

export const buildMacDmgPlan = ({
  arch,
  releaseDir = DEFAULT_RELEASE_DIR,
  version,
  workspaceRoot = WORKSPACE_ROOT,
}: BuildMacDmgPlanOptions): MacDmgPlan => {
  const root = resolve(workspaceRoot);
  const resolvedReleaseDir = isAbsolute(releaseDir) ? releaseDir : join(root, releaseDir);
  const builderOutputDir = join(root, "dist/electron-builder");
  return {
    appName: "AOP.app",
    arch,
    binaryPath: join(resolvedReleaseDir, `aop-darwin-${arch}`),
    builderDmgPath: join(builderOutputDir, `aop-macos-${arch}.dmg`),
    builderOutputDir,
    builderZipPath: join(builderOutputDir, macUpdateZipName(arch)),
    dmgPath: join(resolvedReleaseDir, `aop-macos-${arch}.dmg`),
    releaseDir: resolvedReleaseDir,
    resourcesDir: join(root, "apps/desktop/resources"),
    runtimeAssetsArchive: join(resolvedReleaseDir, "runtime-assets.tar.gz"),
    version,
    volumeName: `AOP ${version} ${arch}`,
    workspaceRoot: root,
    zipPath: join(resolvedReleaseDir, macUpdateZipName(arch)),
  };
};

export const parseMacSigningConfig = (
  env: Partial<Record<string, string | undefined>> = process.env,
): MacSigningConfig => {
  const identity = env.AOP_MACOS_SIGN_IDENTITY?.trim();
  const shouldNotarize = isTruthy(env.AOP_MACOS_NOTARIZE);
  if (!identity) {
    if (shouldNotarize) throw new Error("AOP_MACOS_NOTARIZE requires AOP_MACOS_SIGN_IDENTITY");
    return { mode: "unsigned" };
  }
  if (!shouldNotarize) {
    return { mode: "signed", identity, notarization: { enabled: false } };
  }
  const appleId = env.APPLE_ID?.trim();
  const teamId = env.APPLE_TEAM_ID?.trim();
  const appSpecificPassword = env.APPLE_APP_SPECIFIC_PASSWORD?.trim();
  if (!appleId || !teamId || !appSpecificPassword) {
    throw new Error(
      "AOP_MACOS_NOTARIZE requires APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD",
    );
  }
  return {
    mode: "signed",
    identity,
    notarization: { enabled: true, appleId, appSpecificPassword, teamId },
  };
};

export const buildMacDmgArtifacts = async ({
  arch,
  releaseDir = DEFAULT_RELEASE_DIR,
  signingConfig = parseMacSigningConfig(),
  version,
  workspaceRoot = WORKSPACE_ROOT,
}: BuildMacDmgArtifactsOptions = {}): Promise<string[]> => {
  ensureMacHost();
  const buildVersion = version ?? (await readPackageVersion(workspaceRoot));
  const plans = (arch ? [arch] : MAC_ARCHES).map((currentArch) =>
    buildMacDmgPlan({ arch: currentArch, releaseDir, version: buildVersion, workspaceRoot }),
  );
  const outputs: string[] = [];
  for (const plan of plans) {
    await buildSingleDmg(plan, signingConfig);
    outputs.push(plan.dmgPath, plan.zipPath);
  }
  // It names the zip of every architecture, so a one-architecture build cannot write it.
  if (!arch && plans[0]) {
    outputs.push(await writeLatestMacYml(plans[0].releaseDir, buildVersion));
  }
  return outputs;
};

export const buildCodesignCommand = (
  path: string,
  signingConfig: MacSigningConfig,
): string[] | undefined =>
  signingConfig.mode === "unsigned"
    ? undefined
    : [
        "codesign",
        "--force",
        "--options",
        "runtime",
        "--timestamp",
        "--sign",
        signingConfig.identity,
        path,
      ];

export const buildDmgNotarizationCommands = (
  dmgPath: string,
  signingConfig: MacSigningConfig,
): string[][] => {
  if (signingConfig.mode !== "signed" || !signingConfig.notarization.enabled) return [];
  const { appleId, appSpecificPassword, teamId } = signingConfig.notarization;
  return [
    [
      "xcrun",
      "notarytool",
      "submit",
      dmgPath,
      "--apple-id",
      appleId,
      "--password",
      appSpecificPassword,
      "--team-id",
      teamId,
      "--wait",
    ],
    ["xcrun", "stapler", "staple", dmgPath],
    ["xcrun", "stapler", "validate", dmgPath],
  ];
};

const buildSingleDmg = async (plan: MacDmgPlan, signingConfig: MacSigningConfig): Promise<void> => {
  console.log(`Packaging ${plan.appName} with Electron for macOS ${plan.arch}...`);
  const codesignCommand = buildCodesignCommand(plan.binaryPath, signingConfig);
  if (codesignCommand) await runCommand(codesignCommand, plan.workspaceRoot);

  await prepareElectronResources(
    buildElectronResourcePlan({
      arch: plan.arch,
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
      "--mac",
      "dmg",
      "zip",
      `--${plan.arch}`,
      "--publish",
      "never",
    ],
    plan.workspaceRoot,
    electronBuilderSigningEnv(signingConfig),
  );
  await assertFile(plan.builderDmgPath, "Electron Builder did not produce the expected DMG.");
  await cp(plan.builderDmgPath, plan.dmgPath);
  await assertFile(
    plan.builderZipPath,
    "Electron Builder did not produce the expected update zip.",
  );
  await cp(plan.builderZipPath, plan.zipPath);

  for (const command of buildDmgNotarizationCommands(plan.dmgPath, signingConfig)) {
    await runCommand(
      command,
      plan.workspaceRoot,
      {},
      command[1] === "notarytool" ? "xcrun notarytool submit [redacted]" : undefined,
    );
  }
  console.log(`Built ${plan.dmgPath}`);
};

export const electronBuilderSigningEnv = (
  signingConfig: MacSigningConfig,
): Record<string, string> => {
  // Electron Builder skips all signing on CI pull requests, which would leave the unsigned app
  // without even the ad-hoc signature Apple silicon needs to launch it. No certificate is involved.
  if (signingConfig.mode === "unsigned") {
    return { CSC_IDENTITY_AUTO_DISCOVERY: "false", CSC_FOR_PULL_REQUEST: "true" };
  }
  const env: Record<string, string> = {
    CSC_IDENTITY_AUTO_DISCOVERY: "true",
    CSC_NAME: signingConfig.identity.replace(/^Developer ID Application:\s*/u, ""),
  };
  if (signingConfig.notarization.enabled) {
    env.AOP_MACOS_NOTARIZE = "1";
    env.APPLE_ID = signingConfig.notarization.appleId;
    env.APPLE_APP_SPECIFIC_PASSWORD = signingConfig.notarization.appSpecificPassword;
    env.APPLE_TEAM_ID = signingConfig.notarization.teamId;
  }
  return env;
};

const readPackageVersion = async (workspaceRoot: string): Promise<string> => {
  const packageJson = await Bun.file(join(workspaceRoot, "package.json")).json();
  return String(packageJson.version);
};

const ensureMacHost = (): void => {
  if (process.platform !== "darwin") {
    throw new Error("macOS DMG packaging requires a macOS host with hdiutil");
  }
};

const parseArch = (value: string | undefined): MacArch | undefined => {
  if (!value) return undefined;
  if (MAC_ARCHES.includes(value as MacArch)) return value as MacArch;
  throw new Error(`Unknown macOS arch "${value}". Use x64 or arm64.`);
};

const isTruthy = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";

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
  errorLabel?: string,
): Promise<void> => {
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${errorLabel ?? command.join(" ")}`);
  }
};

const main = async (): Promise<void> => {
  const cli = cac("macos-dmg");
  cli
    .option("--arch <arch>", "Build one architecture only (x64 or arm64)")
    .option("--release-dir <path>", "Release artifact directory", {
      default: DEFAULT_RELEASE_DIR,
    })
    .option("--version <version>", "Version label for the DMG volume");
  const { options } = cli.parse();
  const values = options as CliOptions;
  await buildMacDmgArtifacts({
    arch: parseArch(values.arch),
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
