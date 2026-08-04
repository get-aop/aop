#!/usr/bin/env bun
/**
 * Production build script for the dashboard.
 * Uses Bun's built-in bundler for React + TypeScript.
 * Tailwind CSS is processed via postcss.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { configureLogging, getLogger } from "@aop/infra";

const log = getLogger("build");

const DIST_DIR = "./dist";
const SRC_DIR = "./src";

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
  log.info("CSS built successfully");
}

interface BuildJsResult {
  js?: string;
  css?: string;
}

async function buildJS(): Promise<BuildJsResult> {
  const result = await Bun.build({
    entrypoints: [`${SRC_DIR}/main.tsx`],
    outdir: DIST_DIR,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "external",
    // Disabled due to Bun 1.3.6 bundler bug (cross-chunk exports resolve to undefined)
    // Re-enable after upgrading Bun and verifying mdast-util-phrasing/unist-util-is work
    splitting: false,
    naming: "[name]-[hash].[ext]",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });

  if (!result.success) {
    log.error("Build failed");
    for (const buildLog of result.logs) {
      log.error("{log}", { log: String(buildLog) });
    }
    process.exit(1);
  }

  const js = result.outputs.find((o) => o.path.endsWith(".js") && o.path.includes("main"));
  const css = result.outputs.find((o) => o.path.endsWith(".css"));

  return {
    js: js && outputFilename(js.path),
    css: css && outputFilename(css.path),
  };
}

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
