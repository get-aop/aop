#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: local release CLI reports progress to the operator

import { join } from "node:path";
import cac from "cac";
import { readRootVersion } from "./bump-version.ts";
import { normalizeReleaseVersion } from "./versioning.ts";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_REPO = "get-aop/aop-mono";

export interface LocalReleaseOptions {
  version: string;
  repo?: string;
  /** Host OS; selects which desktop installer to build. Defaults to process.platform. */
  platform?: NodeJS.Platform;
  skipBuild?: boolean;
  skipMacos?: boolean;
  skipWindows?: boolean;
  skipGitHubRelease?: boolean;
  skipR2?: boolean;
}

export interface LocalReleasePlanStep {
  label: string;
  command: string[];
}

export interface LocalReleasePlan {
  version: string;
  tag: string;
  repo: string;
  steps: LocalReleasePlanStep[];
}

interface CliOptions {
  version?: string;
  repo?: string;
  skipBuild?: boolean;
  skipMacos?: boolean;
  skipWindows?: boolean;
  skipGithubRelease?: boolean;
  skipR2?: boolean;
  dryRun?: boolean;
}

export const buildLocalReleasePlan = ({
  version,
  repo = DEFAULT_REPO,
  platform = process.platform,
  skipBuild = false,
  skipMacos = false,
  skipWindows = false,
  skipGitHubRelease = false,
  skipR2 = false,
}: LocalReleaseOptions): LocalReleasePlan => {
  const normalized = normalizeReleaseVersion(version);
  const tag = `v${normalized}`;
  const steps: LocalReleasePlanStep[] = [];

  if (!skipBuild) {
    steps.push({ label: "Build release binaries", command: ["bun", "run", "build:release"] });
  }

  // Desktop installers can only be built on their native host, so each host
  // contributes its installer to the same create-or-update GitHub Release.
  if (platform === "darwin" && !skipMacos) {
    steps.push({
      label: "Package signed macOS DMGs",
      command: ["bun", "run", "package:macos-dmg", "--", "--version", normalized],
    });
  }

  if (platform === "win32" && !skipWindows) {
    steps.push({
      label: "Package Windows installer",
      command: ["bun", "run", "package:windows", "--", "--version", normalized],
    });
  }

  steps.push({
    label: "Generate checksums",
    command: ["bun", "run", "./scripts/release/checksums.ts", "dist/release"],
  });

  if (!skipGitHubRelease) {
    // Resolves present artifacts at execution time so a host that cannot build the
    // Windows installer (e.g. macOS local-publish) still publishes the rest cleanly.
    steps.push({
      label: "Create GitHub Release",
      command: ["bun", "run", "./scripts/release/gh-release.ts", tag, repo],
    });
  }

  if (!skipR2) {
    steps.push({
      label: "Deploy release assets to R2",
      command: ["bash", "scripts/release/deploy-r2.sh", normalized],
    });
  }

  steps.push({
    label: "Verify public latest/version",
    command: [
      "sh",
      "-c",
      `for i in $(seq 1 12); do v=$(curl -fsSL https://getaop.com/latest/version || true); echo "$v"; [ "$v" = "${normalized}" ] && exit 0; sleep 10; done; exit 1`,
    ],
  });

  return { version: normalized, tag, repo, steps };
};

export const runLocalReleasePlan = async (
  plan: LocalReleasePlan,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<void> => {
  printPlan(plan);

  if (dryRun) {
    console.log("");
    console.log("Dry run only. No commands were executed.");
    return;
  }

  for (const step of plan.steps) {
    console.log("");
    console.log(`==> ${step.label}`);
    await runCommand(step.command);
  }
};

const printPlan = (plan: LocalReleasePlan): void => {
  console.log(`Local release plan: ${plan.tag}`);
  console.log(`Repository: ${plan.repo}`);
  for (const [index, step] of plan.steps.entries()) {
    console.log(`${index + 1}. ${step.label}`);
    console.log(`   ${step.command.map(shellQuote).join(" ")}`);
  }
};

const runCommand = async (command: string[]): Promise<void> => {
  const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID,
  };
  const proc = Bun.spawn(command, {
    cwd: WORKSPACE_ROOT,
    env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`);
  }
};

const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
};

const resolveCliVersion = async (version?: string): Promise<string> => {
  const candidate = version?.trim();
  if (candidate) {
    return normalizeReleaseVersion(candidate);
  }
  return normalizeReleaseVersion(await readRootVersion());
};

const main = async (): Promise<void> => {
  const cli = cac("release:local");
  cli
    .option("--version <version>", "Release version to publish; defaults to package.json")
    .option("--repo <repo>", "GitHub repository for the release", { default: DEFAULT_REPO })
    .option("--skip-build", "Use existing dist/release binaries")
    .option("--skip-macos", "Skip the macOS DMG build (no-op off macOS)")
    .option("--skip-windows", "Skip the Windows installer build (no-op off Windows)")
    .option("--skip-github-release", "Do not create the GitHub Release")
    .option("--skip-r2", "Do not deploy to Cloudflare R2/latest")
    .option("--dry-run", "Print commands without running them");

  cli.help();
  const { options } = cli.parse();
  const parsedOptions = options as CliOptions;
  const version = await resolveCliVersion(parsedOptions.version);
  const plan = buildLocalReleasePlan({
    version,
    repo: parsedOptions.repo,
    skipBuild: parsedOptions.skipBuild,
    skipMacos: parsedOptions.skipMacos,
    skipWindows: parsedOptions.skipWindows,
    skipGitHubRelease: parsedOptions.skipGithubRelease,
    skipR2: parsedOptions.skipR2,
  });

  await runLocalReleasePlan(plan, { dryRun: parsedOptions.dryRun });
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
