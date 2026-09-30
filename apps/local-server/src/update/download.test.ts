import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { downloadAsset, verifyChecksum } from "./download.ts";
import { scratchDir, serve } from "./test-utils.ts";

const digestOf = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

describe("downloadAsset", () => {
  test("saves a release-sized file from a feed that streams it from disk", async () => {
    const dir = await scratchDir("download");
    const big = new Uint8Array(40 * 1024 * 1024).map((_, index) => index % 251);
    await Bun.write(join(dir, "source"), big);
    const feed = serve(() => new Response(Bun.file(join(dir, "source"))));

    await downloadAsset("aop-darwin-arm64", `${feed.url}/x`, join(dir, "saved"), (url) =>
      fetch(url),
    );

    expect(digestOf(new Uint8Array(await Bun.file(join(dir, "saved")).arrayBuffer()))).toBe(
      digestOf(big),
    );
    feed.stop();
  });

  test("says which file could not be downloaded, and how", async () => {
    const dir = await scratchDir("download");
    const missing = serve(() => new Response("nope", { status: 404 }));
    const unreachable = async () => {
      throw new Error("connection refused");
    };

    await expect(
      downloadAsset("runtime-assets.tar.gz", `${missing.url}/x`, join(dir, "a"), (url) =>
        fetch(url),
      ),
    ).rejects.toThrow("Could not download runtime-assets.tar.gz: the feed answered 404");
    await expect(
      downloadAsset("checksums.sha256", "http://x", join(dir, "b"), unreachable),
    ).rejects.toThrow("Could not download checksums.sha256: connection refused");
    missing.stop();
  });
});

describe("verifyChecksum", () => {
  test("accepts a file whose digest is listed, in the format install.sh reads", async () => {
    const dir = await scratchDir("checksum");
    await Bun.write(join(dir, "file"), "hello");
    const listing = `${digestOf(new TextEncoder().encode("hello"))}  aop-darwin-arm64\nffff  other\n`;

    await verifyChecksum(listing, "aop-darwin-arm64", join(dir, "file"));

    expect(existsSync(join(dir, "file"))).toBe(true);
  });

  test("deletes a file that does not match or is not listed, so it cannot be installed by mistake", async () => {
    const dir = await scratchDir("checksum");
    await Bun.write(join(dir, "bad"), "tampered");
    await Bun.write(join(dir, "unlisted"), "hello");

    await expect(
      verifyChecksum("abc123  aop-darwin-arm64\n", "aop-darwin-arm64", join(dir, "bad")),
    ).rejects.toThrow("Checksum verification failed for aop-darwin-arm64");
    await expect(
      verifyChecksum("abc123  other\n", "aop-darwin-arm64", join(dir, "unlisted")),
    ).rejects.toThrow("No checksum for aop-darwin-arm64 in checksums.sha256");

    expect(existsSync(join(dir, "bad"))).toBe(false);
    expect(existsSync(join(dir, "unlisted"))).toBe(false);
  });
});
