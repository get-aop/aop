import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { digestInChecksums, downloadAsset, verifyDigest } from "./download.ts";
import { scratchDir, serve } from "./test-utils.ts";

const digestOf = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

describe("downloadAsset", () => {
  test("saves a release-sized file from a feed that streams it from disk", async () => {
    const dir = await scratchDir("download");
    const big = new Uint8Array(40 * 1024 * 1024).map((_, index) => index % 251);
    await Bun.write(join(dir, "source"), big);
    const feed = serve(() => new Response(Bun.file(join(dir, "source"))));

    await downloadAsset("aop-darwin-arm64", { url: `${feed.url}/x` }, join(dir, "saved"), (url) =>
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
      downloadAsset("runtime-assets.tar.gz", { url: `${missing.url}/x` }, join(dir, "a"), (url) =>
        fetch(url),
      ),
    ).rejects.toThrow("Could not download runtime-assets.tar.gz: the feed answered 404");
    await expect(
      downloadAsset("checksums.sha256", { url: "http://x" }, join(dir, "b"), unreachable),
    ).rejects.toThrow("Could not download checksums.sha256: connection refused");
    missing.stop();
  });
});

describe("verifyDigest", () => {
  test("accepts a file with the promised digest, whatever its case", async () => {
    const dir = await scratchDir("checksum");
    await Bun.write(join(dir, "file"), "hello");
    const digest = digestOf(new TextEncoder().encode("hello"));

    await verifyDigest("aop-darwin-arm64", join(dir, "file"), digest.toUpperCase());

    expect(existsSync(join(dir, "file"))).toBe(true);
  });

  test("deletes a file that does not match or has no digest, so it cannot be installed by mistake", async () => {
    const dir = await scratchDir("checksum");
    await Bun.write(join(dir, "bad"), "tampered");
    await Bun.write(join(dir, "unlisted"), "hello");

    await expect(verifyDigest("aop-darwin-arm64", join(dir, "bad"), "abc123")).rejects.toThrow(
      "Checksum verification failed for aop-darwin-arm64",
    );
    await expect(verifyDigest("aop-darwin-arm64", join(dir, "unlisted"), null)).rejects.toThrow(
      "No checksum for aop-darwin-arm64",
    );

    expect(existsSync(join(dir, "bad"))).toBe(false);
    expect(existsSync(join(dir, "unlisted"))).toBe(false);
  });
});

describe("digestInChecksums", () => {
  test("reads a line in the format install.sh reads, and nothing else", () => {
    const listing = "ABC123  aop-darwin-arm64\nffff  other\n";

    expect(digestInChecksums(listing, "aop-darwin-arm64")).toBe("abc123");
    expect(digestInChecksums(listing, "aop-linux-x64")).toBeNull();
  });
});
