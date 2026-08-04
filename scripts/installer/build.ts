#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI build script requires console output for user feedback

import { cpSync, existsSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import cac from "cac";
import { generateChecksumFile } from "../release/checksums.ts";

// Windows is x64-only (no bun-windows-arm64 target exists); WoA runs the x64 build via emulation.
const TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
] as const;

type Target = (typeof TARGETS)[number];

const RELEASE_DIR = "./dist/release";
const ENTRYPOINT = "./scripts/installer/entrypoint.ts";
const DASHBOARD_DIST = "./apps/dashboard/dist";
const PROMPTS_DIR = "./apps/local-server/src/prompts";
const RUNTIME_ASSETS_DIR = join(RELEASE_DIR, "runtime-assets");
const RUNTIME_ASSETS_ARCHIVE = "runtime-assets.tar.gz";

const targetToFilename = (target: Target): string => {
  const [, os, arch] = target.split("-");
  // Bun appends .exe for the windows target; bake it into the name so the outfile and
  // checksum inputs reference the real artifact instead of a missing extensionless path.
  const ext = os === "windows" ? ".exe" : "";
  return `aop-${os}-${arch}${ext}`;
};

const getBuildVersion = async (): Promise<string> => {
  const pkg = await Bun.file("./package.json").json();
  const commit = (await Bun.$`git rev-parse --short HEAD`.text()).trim();
  return `${pkg.version}+${commit}`;
};

const buildDashboard = async (): Promise<void> => {
  console.log("Building dashboard...");
  const result = await Bun.$`bun run --filter @aop/dashboard build`.quiet();
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    throw new Error("Dashboard build failed");
  }

  if (!existsSync(join(DASHBOARD_DIST, "index.html"))) {
    throw new Error("Dashboard build succeeded but dist/index.html not found");
  }
  console.log("Dashboard built successfully");
};

const archiveRuntimeAssets = async (): Promise<string> => {
  rmSync(RUNTIME_ASSETS_DIR, { force: true, recursive: true });
  await mkdir(RUNTIME_ASSETS_DIR, { recursive: true });

  cpSync(DASHBOARD_DIST, join(RUNTIME_ASSETS_DIR, "dashboard"), { recursive: true });
  cpSync(join(PROMPTS_DIR, "templates"), join(RUNTIME_ASSETS_DIR, "templates"), {
    recursive: true,
  });
  cpSync(join(PROMPTS_DIR, "methodology"), join(RUNTIME_ASSETS_DIR, "methodology"), {
    recursive: true,
  });
  // Bundled skills were removed; keep copy optional so older trees still package if present.
  const skillsDir = join(PROMPTS_DIR, "skills");
  if (existsSync(skillsDir)) {
    cpSync(skillsDir, join(RUNTIME_ASSETS_DIR, "skills"), { recursive: true });
  }

  const archivePath = join(RELEASE_DIR, RUNTIME_ASSETS_ARCHIVE);
  const result = await Bun.$`tar -czf ${archivePath} -C ${RUNTIME_ASSETS_DIR} .`.quiet();
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    throw new Error("Runtime assets archive failed");
  }
  console.log(`Archived ${RUNTIME_ASSETS_ARCHIVE}`);
  return archivePath;
};

const buildTarget = async (target: Target, version: string): Promise<string> => {
  const filename = targetToFilename(target);
  const outfile = join(RELEASE_DIR, filename);
  console.log(`Building ${filename}...`);

  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    compile: {
      target,
      outfile,
    },
    minify: true,
    define: {
      BUILD_VERSION: JSON.stringify(version),
    },
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(String(log));
    }
    throw new Error(`Build failed for ${target}`);
  }

  console.log(`Built ${filename}`);
  return outfile;
};

const main = async (): Promise<void> => {
  const cli = cac("build");
  cli.option("--target <target>", "Build only a single platform target");
  const { options } = cli.parse();

  const targetFilter = options.target as string | undefined;
  const targets = targetFilter ? TARGETS.filter((t) => t.endsWith(targetFilter)) : [...TARGETS];

  if (targets.length === 0) {
    console.error(
      `Unknown target: ${targetFilter}. Valid: ${TARGETS.map((t) => t.replace("bun-", "")).join(
        ", ",
      )}`,
    );
    process.exit(1);
  }

  if (existsSync(RELEASE_DIR)) {
    rmSync(RELEASE_DIR, { recursive: true });
  }
  await mkdir(RELEASE_DIR, { recursive: true });

  await buildDashboard();
  const runtimeAssetsArchive = await archiveRuntimeAssets();

  const version = await getBuildVersion();
  console.log(`Version: ${version}`);

  const outputs: string[] = [runtimeAssetsArchive];
  for (const target of targets) {
    const outfile = await buildTarget(target, version);
    outputs.push(outfile);
  }

  await generateChecksumFile(outputs, join(RELEASE_DIR, "checksums.sha256"));
  console.log("Generated checksums.sha256");

  console.log(`\nBuild complete! ${outputs.length} artifacts in ${RELEASE_DIR}/`);
};

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
