#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: release CLI prints what to prune for deploy-nightly.sh

import { compareReleaseVersions, isNightlyVersion } from "@aop/common";
import cac from "cac";

/**
 * `nightly/releases/index.json` on getaop.com: every nightly still published, newest first.
 * deploy-nightly.sh adds the build it publishes and deletes the files of every build past the
 * newest `keep` (docs/NIGHTLY.md, retention).
 */
export interface NightlyBuild {
  version: string;
  commit: string;
  publishedAt: string;
}

export interface NightlyIndex {
  builds: NightlyBuild[];
}

export const DEFAULT_KEEP = 10;

/** Reads the published index; a missing or unreadable one starts empty. */
export const parseNightlyIndex = (text: string | null): NightlyIndex => {
  if (!text) return { builds: [] };
  try {
    const parsed = JSON.parse(text) as { builds?: unknown };
    return Array.isArray(parsed.builds) && parsed.builds.every(isBuild)
      ? { builds: parsed.builds }
      : { builds: [] };
  } catch {
    return { builds: [] };
  }
};

const isBuild = (value: unknown): value is NightlyBuild => {
  const entry = value as Partial<NightlyBuild> | null;
  return (
    typeof entry?.version === "string" &&
    typeof entry.commit === "string" &&
    typeof entry.publishedAt === "string"
  );
};

/** The index with `build` added, and the versions that fall past the newest `keep`. */
export const addNightlyBuild = (
  index: NightlyIndex,
  build: NightlyBuild,
  keep: number = DEFAULT_KEEP,
): { index: NightlyIndex; prune: string[] } => {
  if (!isNightlyVersion(build.version)) throw new Error(`Not a nightly version: ${build.version}`);
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`keep must be at least 1, not ${keep}`);
  const others = index.builds.filter(
    (entry) => entry.version !== build.version && isNightlyVersion(entry.version),
  );
  const builds = [build, ...others].sort((a, b) => compareReleaseVersions(b.version, a.version));
  return {
    index: { builds: builds.slice(0, keep) },
    prune: builds.slice(keep).map((entry) => entry.version),
  };
};

const main = async (): Promise<void> => {
  const cli = cac("nightly-index");
  cli
    .option("--index <path>", "The published index.json; a missing file starts empty")
    .option("--version <version>", "The nightly being published")
    .option("--commit <sha>", "Its commit")
    .option("--published-at <iso>", "When it was published")
    .option("--keep <count>", "How many builds stay published", { default: DEFAULT_KEEP })
    .option("--out <path>", "Where to write the new index");
  const { options } = cli.parse();
  if (!options.index || !options.version || !options.commit || !options.out) {
    throw new Error(
      "Usage: nightly-index.ts --index <path> --version <v> --commit <sha> --out <path>",
    );
  }
  const file = Bun.file(String(options.index));
  const current = parseNightlyIndex((await file.exists()) ? await file.text() : null);
  const { index, prune } = addNightlyBuild(
    current,
    {
      version: String(options.version),
      commit: String(options.commit),
      publishedAt: String(options.publishedAt ?? new Date().toISOString()),
    },
    Number(options.keep),
  );
  await Bun.write(String(options.out), `${JSON.stringify(index, null, 2)}\n`);
  for (const version of prune) console.log(version);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
