#!/usr/bin/env bun
/**
 * Production build script for the dashboard.
 * Uses Bun's built-in bundler for React + TypeScript.
 * Tailwind CSS is processed via postcss.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { channelDefine, parseReleaseChannel } from "@aop/common";
import { configureLogging, getLogger } from "@aop/infra";
import { emitFontFiles } from "./font-files";

const log = getLogger("build");

const DIST_DIR = "./dist";
const SRC_DIR = "./src";

export const dashboardBuildOptions = {
  entrypoints: [`${SRC_DIR}/main.tsx`],
  outdir: DIST_DIR,
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "external",
  splitting: true,
  naming: "[name]-[hash].[ext]",
  define: {
    "process.env.NODE_ENV": '"production"',
    // AOP_BUILD_CHANNEL=nightly builds AOP Nightly's dashboard (docs/NIGHTLY.md).
    ...channelDefine(parseReleaseChannel(process.env.AOP_BUILD_CHANNEL)),
  },
} satisfies Parameters<typeof Bun.build>[0];

export const outputFilename = (outputPath: string): string => {
  const filename = outputPath.split(/[/\\]/).at(-1);
  if (!filename) {
    throw new Error(`Build output has no filename: ${outputPath}`);
  }
  return filename;
};

async function buildCSS(): Promise<void> {
  const cssPath = `${SRC_DIR}/index.css`;
  const tailwindBinary = "./node_modules/.bin/tailwindcss";

  log.info("Building CSS with Tailwind...");

  const result = await Bun.$`${tailwindBinary} -i ${cssPath} -o ${DIST_DIR}/index.css --minify`;
  if (result.exitCode !== 0) {
    log.error("Tailwind stderr: {stderr}", { stderr: result.stderr.toString() });
    log.error("Tailwind stdout: {stdout}", { stdout: result.stdout.toString() });
    throw new Error(`Tailwind build failed with exit code ${result.exitCode}`);
  }
  const fontFiles = emitFontFiles(readFileSync(`${DIST_DIR}/index.css`, "utf-8"), DIST_DIR);
  log.info("CSS built successfully with {count} font files", { count: fontFiles.length });
}

interface BuildJsResult {
  js?: string;
  css?: string;
}

async function buildJS(): Promise<BuildJsResult> {
  const result = await Bun.build(dashboardBuildOptions);

  if (!result.success) {
    log.error("Build failed");
    for (const buildLog of result.logs) {
      log.error("{log}", { log: String(buildLog) });
    }
    process.exit(1);
  }

  return pickPageOutputs(result.outputs);
}

/**
 * The script and stylesheet index.html loads. The script is Bun's entry point, found by its
 * kind: matching "main" in the path picked a random chunk whenever the checkout's own folder
 * had "main" in its name, and the page then loaded nothing.
 */
export const pickPageOutputs = (
  outputs: ReadonlyArray<Pick<Bun.BuildArtifact, "path" | "kind">>,
): BuildJsResult => {
  const js = outputs.find((o) => o.kind === "entry-point" && o.path.endsWith(".js"));
  const css = outputs.find((o) => o.path.endsWith(".css"));
  return {
    js: js && outputFilename(js.path),
    css: css && outputFilename(css.path),
  };
};

async function buildHTML({ js, css }: BuildJsResult): Promise<void> {
  const html = readFileSync(`${SRC_DIR}/index.html`, "utf-8");
  const bundleCssLink = css ? `\n    <link rel="stylesheet" href="/${css}" />` : "";

  const prodHtml = html
    .replace(
      /<script type=["']module["'] src=["']\/src\/main\.tsx["']><\/script>/,
      `<script type="module" src="/${js ?? "main.js"}"></script>`,
    )
    .replace(
      /<link rel=["']stylesheet["'] href=["']\/src\/index\.css["']\s*\/?>/,
      `<link rel="stylesheet" href="/index.css" />${bundleCssLink}`,
    );

  writeFileSync(`${DIST_DIR}/index.html`, prodHtml);
}

async function build(): Promise<void> {
  await configureLogging({ format: "pretty", serviceName: "dashboard" });
  log.info("Building dashboard...");

  // Clean dist
  if (existsSync(DIST_DIR)) {
    rmSync(DIST_DIR, { recursive: true });
  }
  mkdirSync(DIST_DIR);

  // Build in parallel
  const [, jsResult] = await Promise.all([buildCSS(), buildJS()]);

  await buildHTML(jsResult);

  copyFileSync("./icon.svg", `${DIST_DIR}/icon.svg`);

  log.info("Dashboard built successfully!");
}

if (import.meta.main) {
  build().catch(async (err) => {
    await configureLogging({ format: "pretty", serviceName: "dashboard" });
    log.error("Build failed: {error}", { error: String(err) });
    process.exit(1);
  });
}
