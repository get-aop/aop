#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release CLI reports progress to the operator

import { join } from "node:path";
import cac from "cac";
import { bumpWorkspaceVersions, readRootVersion } from "./bump-version.ts";
import { resolveNextReleaseVersion, type SemverBump } from "./semver.ts";
import { normalizeReleaseVersion } from "./versioning.ts";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");

interface ReleaseOptions {
  dryRun: boolean;
  noPush: boolean;
  skipCheck: boolean;
}

const isSemverBump = (value: string): value is SemverBump =>
  value === "patch" || value === "minor" || value === "major";

const ensureCleanWorkingTree = async (): Promise<void> => {
  const status = (await Bun.$`git status --porcelain`.cwd(WORKSPACE_ROOT).text()).trim();
  if (status.length > 0) {
    throw new Error("Working tree must be clean before release. Commit or stash changes first.");
  }
};

const ensureTagDoesNotExist = async (tag: string): Promise<void> => {
  const result = await Bun.$`git rev-parse ${tag}`.cwd(WORKSPACE_ROOT).quiet().nothrow();
  if (result.exitCode === 0) {
    throw new Error(`Git tag ${tag} already exists`);
  }
};

const runReleaseChecks = async (): Promise<void> => {
  console.log("Running bun check...");
  const result = await Bun.$`bun check`.cwd(WORKSPACE_ROOT).quiet().nothrow();
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    throw new Error("bun check failed");
  }
};

const commitRelease = async (version: string): Promise<void> => {
  for (const relativePath of [
    "package.json",
    "apps/cli/package.json",
    "apps/dashboard/package.json",
    "apps/desktop/package.json",
    "apps/local-server/package.json",
    "packages/common/package.json",
    "packages/git-manager/package.json",
    "packages/infra/package.json",
    "packages/llm-provider/package.json",
    "e2e-tests/package.json",
  ]) {
    await Bun.$`git add ${relativePath}`.cwd(WORKSPACE_ROOT).quiet().nothrow();
  }

  const message = `chore: release v${version}`;
  await Bun.$`git commit -m ${message}`.cwd(WORKSPACE_ROOT).quiet();
};

const createTag = async (version: string): Promise<void> => {
  const tag = `v${version}`;
  await Bun.$`git tag ${tag}`.cwd(WORKSPACE_ROOT).quiet();
};

const pushRelease = async (version: string): Promise<void> => {
  const tag = `v${version}`;
  await Bun.$`git push origin HEAD`.cwd(WORKSPACE_ROOT).quiet();
  await Bun.$`git push origin ${tag}`.cwd(WORKSPACE_ROOT).quiet();
};

export const runRelease = async (
  target: SemverBump | string,
  options: ReleaseOptions,
): Promise<{ version: string; tag: string; updatedPaths: string[] }> => {
  const currentVersion = await readRootVersion();
  const nextVersion = resolveNextReleaseVersion(currentVersion, target);
  const tag = `v${nextVersion}`;

  console.log(`Release plan: ${currentVersion} -> ${nextVersion} (${tag})`);

  if (options.dryRun) {
    console.log("Dry run only. No files, commits, tags, or pushes were made.");
    return { version: nextVersion, tag, updatedPaths: [] };
  }

  await ensureCleanWorkingTree();
  await ensureTagDoesNotExist(tag);

  if (!options.skipCheck) {
    await runReleaseChecks();
  }

  const updatedPaths = await bumpWorkspaceVersions(nextVersion);
  if (updatedPaths.length === 0) {
    throw new Error(`Version is already ${nextVersion} in workspace package.json files`);
  }

  console.log(`Updated ${updatedPaths.length} package.json files`);

  await commitRelease(nextVersion);
  await createTag(nextVersion);

  if (!options.noPush) {
    console.log("Pushing commit and tag...");
    await pushRelease(nextVersion);
    console.log("");
    console.log("Release commit and tag pushed.");
    console.log(
      "The Release workflow (macOS + Windows + Linux + R2 deploy) now runs from the tag push.",
    );
    console.log("Watch it with: gh run watch --repo get-aop/aop-mono");
    console.log("");
  } else {
    console.log("");
    console.log(`Created local commit and tag ${tag}. Push manually with:`);
    console.log("  git push origin HEAD");
    console.log(`  git push origin ${tag}`);
  }

  return { version: nextVersion, tag, updatedPaths };
};

const main = async (): Promise<void> => {
  const cli = cac("release");
  cli
    .command("[target]", "Release AOP (patch, minor, major, or explicit X.Y.Z)")
    .option("--dry-run", "Print the release plan without changing anything")
    .option("--no-push", "Commit and tag locally but do not push")
    .option("--skip-check", "Skip bun check before committing the version bump")
    .action(async (target: string | undefined, options: ReleaseOptions) => {
      const releaseTarget = target?.trim();
      if (!releaseTarget) {
        console.error("Missing release target. Use patch, minor, major, or an explicit version.");
        process.exit(1);
      }

      if (!isSemverBump(releaseTarget)) {
        normalizeReleaseVersion(releaseTarget);
      }

      await runRelease(releaseTarget, options);
    });

  cli.help();
  cli.parse();
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
