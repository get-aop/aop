#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: a developer tool that reports where it listens

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { latestReleaseApiUrl, RELEASE_REPO } from "@aop/common";
import cac from "cac";

export interface FakeFeed {
  /** Set `AOP_GITHUB_API_URL` to this so the host and the apps read the feed from here. */
  url: string;
  stop: () => void;
}

/**
 * A stand-in for the GitHub Releases of get-aop/aop-mono: `GET /repos/<repo>/releases/latest`
 * describes one release, and its assets are the files in `dir`, served from `/download/<name>`.
 * The update paths are tried against this, never against the real releases.
 */
export const startFakeFeed = async (options: {
  dir: string;
  version: string;
  port?: number;
}): Promise<FakeFeed> => {
  const names = await readdir(options.dir);
  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      const base = new URL(request.url).origin;
      if (pathname === new URL(latestReleaseApiUrl(base)).pathname) {
        return Response.json({
          tag_name: `v${options.version}`,
          html_url: `${base}/releases/tag/v${options.version}`,
          draft: false,
          prerelease: false,
          assets: names.map((name) => ({
            name,
            browser_download_url: `${base}/download/${name}`,
          })),
        });
      }
      if (pathname.startsWith("/download/")) {
        const name = decodeURIComponent(pathname.slice("/download/".length));
        return names.includes(name)
          ? new Response(Bun.file(join(options.dir, name)))
          : new Response("not found", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
};

const main = async (): Promise<void> => {
  const cli = cac("fake-feed");
  cli
    .option("--dir <path>", "Directory whose files are the release assets")
    .option("--version <version>", "Version the release reports, such as 0.10.0")
    .option("--port <port>", "Port to listen on");
  const { options } = cli.parse();
  if (!options.dir || !options.version) {
    throw new Error(
      `Usage: fake-feed --dir <assets> --version <x.y.z> [--port <port>] (repo ${RELEASE_REPO})`,
    );
  }
  const feed = await startFakeFeed({
    dir: String(options.dir),
    version: String(options.version),
    port: options.port ? Number(options.port) : undefined,
  });
  console.log(`Fake release feed on ${feed.url} (set AOP_GITHUB_API_URL=${feed.url})`);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
