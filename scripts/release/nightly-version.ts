#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release CLI prints the version for the workflow

import { appendFile } from "node:fs/promises";
import { isNightlyVersion } from "@aop/common";
import cac from "cac";
import { bumpSemver } from "./semver.ts";

/**
 * AOP Nightly's version: the release that comes next (the patch after package.json), the build
 * date and the workflow run, `0.10.7-nightly.20261002.14` (docs/NIGHTLY.md). Semver sorts it
 * above the release it follows and below the one it previews; the run number orders builds of
 * one day. The commit goes into the host's build metadata (`+c213357`) and the feed, never here,
 * because a hash does not sort.
 */
export const nightlyVersion = (packageVersion: string, date: Date, runNumber: number): string => {
  if (!Number.isInteger(runNumber) || runNumber < 1) {
    throw new Error(`A nightly needs a positive run number, not ${runNumber}`);
  }
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  const version = `${bumpSemver(packageVersion, "patch")}-nightly.${day}.${runNumber}`;
  if (!isNightlyVersion(version)) throw new Error(`Not a nightly version: ${version}`);
  return version;
};

const main = async (): Promise<void> => {
  const cli = cac("nightly-version");
  cli
    .option("--run <number>", "The workflow run number (GITHUB_RUN_NUMBER)")
    .option("--github-output", "Append version=<version> to $GITHUB_OUTPUT");
  const { options } = cli.parse();
  const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json();
  const version = nightlyVersion(String(pkg.version), new Date(), Number(options.run));
  if (options.githubOutput) {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error("--github-output needs GITHUB_OUTPUT");
    await appendFile(output, `version=${version}\n`);
  }
  console.log(version);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
