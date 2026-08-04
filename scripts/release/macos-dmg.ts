#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release packaging CLI reports progress to the operator

import { cp, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import cac from "cac";
import {
  buildTauriSidecarResourcePlan,
  prepareTauriSidecarResources,
} from "../desktop/prepare-tauri-sidecar.ts";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_RELEASE_DIR = "dist/release";
const MAC_ARCHES = ["x64", "arm64"] as const;

export type MacArch = (typeof MAC_ARCHES)[number];

export interface MacDmgPlan {
  appName: string;
  arch: MacArch;
  binaryPath: string;
  dmgPath: string;
  releaseDir: string;
  resourcesDir: string;
  runtimeAssetsArchive: string;
  targetTriple: string;
  tauriBundleDir: string;
  version: string;
  volumeName: string;
  workspaceRoot: string;
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
  const targetTriple = targetTripleForArch(arch);

  return {
    appName: "AOP.app",
    arch,
    binaryPath: join(resolvedReleaseDir, `aop-darwin-${arch}`),
    dmgPath: join(resolvedReleaseDir, `aop-macos-${arch}.dmg`),
    releaseDir: resolvedReleaseDir,
    resourcesDir: join(root, "apps/desktop/src-tauri/resources"),
    runtimeAssetsArchive: join(resolvedReleaseDir, "runtime-assets.tar.gz"),
    targetTriple,
    tauriBundleDir: join(root, "apps/desktop/src-tauri/target", targetTriple, "release/bundle/dmg"),
    version,
    volumeName: `AOP ${version} ${arch}`,
    workspaceRoot: root,
  };
};

export const targetTripleForArch = (arch: MacArch): string => {
  if (arch === "arm64") return "aarch64-apple-darwin";
  return "x86_64-apple-darwin";
};

export const parseMacSigningConfig = (
  env: Partial<Record<string, string | undefined>> = process.env,
): MacSigningConfig => {
  const identity = env.AOP_MACOS_SIGN_IDENTITY?.trim();
  const shouldNotarize = isTruthy(env.AOP_MACOS_NOTARIZE);

  if (!identity) {
    if (shouldNotarize) {
      throw new Error("AOP_MACOS_NOTARIZE requires AOP_MACOS_SIGN_IDENTITY");
    }
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
    notarization: {
      enabled: true,
      appleId,
      appSpecificPassword,
      teamId,
    },
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
  const arches = arch ? [arch] : [...MAC_ARCHES];
  const outputs: string[] = [];

  for (const currentArch of arches) {
    const plan = buildMacDmgPlan({
      arch: currentArch,
      releaseDir,
      version: buildVersion,
      workspaceRoot,
    });

    await buildSingleDmg(plan, signingConfig);
    outputs.push(plan.dmgPath);
  }

  // checksums.sha256 is generated once by the central release job over all artifacts
  // (binaries + DMGs + Windows installer), so packaging jobs no longer write it.
  return outputs;
};

const buildSingleDmg = async (plan: MacDmgPlan, signingConfig: MacSigningConfig): Promise<void> => {
  console.log(`Packaging ${plan.appName} with Tauri for macOS ${plan.arch}...`);

  const codesignCommand = buildCodesignCommand(plan.binaryPath, signingConfig);
  if (codesignCommand) {
    await runCommand(codesignCommand, plan.workspaceRoot);
  }

  await prepareTauriSidecarResources(
    buildTauriSidecarResourcePlan({
      arch: plan.arch,
      releaseDir: plan.releaseDir,
      workspaceRoot: plan.workspaceRoot,
    }),
  );
  await runCommand(["rustup", "target", "add", plan.targetTriple], plan.workspaceRoot);
  await runCommand(
    [
      "bun",
      "run",
      "--filter",
      "@aop/desktop",
      "tauri",
      "build",
      "--ci",
      "--bundles",
      "dmg",
      "--target",
      plan.targetTriple,
    ],
    plan.workspaceRoot,
    tauriSigningEnv(signingConfig),
  );

  const generatedDmg = await findGeneratedTauriDmg(plan.tauriBundleDir);
  await cp(generatedDmg, plan.dmgPath);

  for (const command of buildDmgNotarizationCommands(plan.dmgPath, signingConfig)) {
    const errorLabel =
      command[1] === "notarytool" ? "xcrun notarytool submit [redacted]" : undefined;
    await runCommand(command, plan.workspaceRoot, {}, errorLabel);
  }

  console.log(`Built ${plan.dmgPath}`);
};

export const buildCodesignCommand = (
  path: string,
  signingConfig: MacSigningConfig,
): string[] | undefined => {
  if (signingConfig.mode === "unsigned") {
    return undefined;
  }

  return [
    "codesign",
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    signingConfig.identity,
    path,
  ];
};

export const buildDmgNotarizationCommands = (
  dmgPath: string,
  signingConfig: MacSigningConfig,
): string[][] => {
  if (signingConfig.mode !== "signed" || !signingConfig.notarization.enabled) {
    return [];
  }

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

const tauriSigningEnv = (signingConfig: MacSigningConfig): Record<string, string> => {
  const env: Record<string, string> = { CI: "true" };

  if (signingConfig.mode === "unsigned") {
    return env;
  }

  env.APPLE_SIGNING_IDENTITY = signingConfig.identity;

  if (signingConfig.notarization.enabled) {
    env.APPLE_ID = signingConfig.notarization.appleId;
    env.APPLE_PASSWORD = signingConfig.notarization.appSpecificPassword;
    env.APPLE_TEAM_ID = signingConfig.notarization.teamId;
  }

  return env;
};

const runCommand = async (
  command: string[],
  cwd: string,
  env: Record<string, string> = {},
  errorLabel?: string,
): Promise<void> => {
  const proc = Bun.spawn(command, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stderr: "inherit",
    stdout: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${errorLabel ?? command.join(" ")}`);
  }
};

const findGeneratedTauriDmg = async (bundleDir: string): Promise<string> => {
  const entries = await readdir(bundleDir);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".dmg"))
      .map(async (entry) => {
        const path = join(bundleDir, entry);
        return { path, modifiedMs: (await stat(path)).mtimeMs };
      }),
  );

  const latest = candidates.toSorted((a, b) => b.modifiedMs - a.modifiedMs)[0];
  if (!latest) {
    throw new Error(`Tauri did not produce a DMG in ${bundleDir}`);
  }

  return latest.path;
};

const main = async (): Promise<void> => {
  const cli = cac("macos-dmg");
  cli
    .option("--arch <arch>", "Build one architecture only (x64 or arm64)")
    .option("--release-dir <path>", "Release artifact directory", { default: DEFAULT_RELEASE_DIR })
    .option("--version <version>", "Version label for the DMG volume");

  const { options } = cli.parse();
  await buildMacDmgArtifacts({
    arch: parseArch((options as CliOptions).arch),
    releaseDir: (options as CliOptions)["release-dir"],
    version: (options as CliOptions).version,
  });
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
