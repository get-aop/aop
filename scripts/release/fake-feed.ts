#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: a developer tool that reports where it listens

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import cac from "cac";
import { generateReleaseChecksums } from "./checksums.ts";
import { buildFeedDocuments } from "./release-feed.ts";

export interface FakeFeed {
  /** Set `AOP_RELEASE_FEED_URL` to this so the host and the apps read the feed from here. */
  url: string;
  stop: () => void;
}

/**
 * A stand-in for getaop.com: the release feed deploy-r2.sh publishes (built by the same code
 * from the files in `dir`), and the files themselves under `/v<version>/`. The update paths are
 * tried against this, never against the real releases. `dir` needs a checksums.sha256; one is
 * written when it has none.
 */
export const startFakeFeed = async (options: {
  dir: string;
  version: string;
  port?: number;
  notes?: string;
}): Promise<FakeFeed> => {
  const names = await readdir(options.dir);
  if (!names.includes("checksums.sha256")) await generateReleaseChecksums(options.dir);
  let documents: Record<string, string> = {};
  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: "127.0.0.1",
    fetch: (request) => {
      const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
      const document = documents[key];
      if (document !== undefined) {
        const json = key.endsWith(".json") || key.startsWith("repos/");
        return new Response(document, {
          headers: { "content-type": json ? "application/json" : "text/plain; charset=utf-8" },
        });
      }
      const prefix = `v${options.version}/`;
      const name = key.startsWith(prefix) ? key.slice(prefix.length) : "";
      return names.includes(name)
        ? new Response(Bun.file(join(options.dir, name)))
        : new Response("not found", { status: 404 });
    },
  });
  const url = `http://127.0.0.1:${server.port}`;
  const docs = await buildFeedDocuments({
    releaseDir: options.dir,
    version: options.version,
    notes: options.notes ?? `Release notes of ${options.version} (fake feed).`,
    publishedAt: new Date().toISOString(),
    origin: url,
  });
  documents = { ...docs.versioned, ...docs.pointers };
  names.splice(0, names.length, ...(await readdir(options.dir)));
  return { url, stop: () => server.stop(true) };
};

const main = async (): Promise<void> => {
  const cli = cac("fake-feed");
  cli
    .option("--dir <path>", "Directory whose files are the release assets")
    .option("--version <version>", "Version the release reports, such as 0.10.0")
    .option("--port <port>", "Port to listen on");
  const { options } = cli.parse();
  if (!options.dir || !options.version) {
    throw new Error("Usage: fake-feed --dir <assets> --version <x.y.z> [--port <port>]");
  }
  const feed = await startFakeFeed({
    dir: String(options.dir),
    version: String(options.version),
    port: options.port ? Number(options.port) : undefined,
  });
  console.log(`Fake release feed on ${feed.url} (set AOP_RELEASE_FEED_URL=${feed.url})`);
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
