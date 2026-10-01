import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import type { ReleaseAsset } from "@aop/common";
import { CHECKSUMS_NAME, type FetchFn, messageOf } from "./release-feed.ts";

/** Saves `asset` to `path`. Assets are large, so the body is streamed to disk, not held in memory. */
export const downloadAsset = async (
  name: string,
  asset: Pick<ReleaseAsset, "url" | "headers">,
  path: string,
  fetchFn: FetchFn,
): Promise<void> => {
  let response: Response;
  try {
    response = await fetchFn(asset.url, asset.headers ? { headers: asset.headers } : undefined);
  } catch (error) {
    throw new Error(`Could not download ${name}: ${messageOf(error)}`);
  }
  if (!response.ok)
    throw new Error(`Could not download ${name}: the feed answered ${response.status}`);
  if (!response.body) throw new Error(`Could not download ${name}: the feed sent no data`);
  // Streamed chunk by chunk: `Bun.write(path, response)` never finishes for a large body.
  const writer = Bun.file(path).writer();
  try {
    for await (const chunk of response.body) writer.write(chunk);
  } finally {
    await writer.end();
  }
};

/** The digest `checksums.sha256` lists for `name` (`<hex>  <name>`, what install.sh reads). */
export const digestInChecksums = (checksums: string, name: string): string | null => {
  for (const line of checksums.split("\n")) {
    const [digest, listed] = line.trim().split(/\s+/);
    if (listed === name && digest) return digest.toLowerCase();
  }
  return null;
};

/**
 * Checks `file` against the sha256 the release promised for it. A missing digest fails as
 * firmly as a wrong one: an unlisted file is an unverified one. The file is deleted on failure
 * so it can never be installed by mistake.
 */
export const verifyDigest = async (
  name: string,
  file: string,
  expected: string | null,
): Promise<void> => {
  if (!expected) {
    await rm(file, { force: true });
    throw new Error(`No checksum for ${name} in the release feed or ${CHECKSUMS_NAME}`);
  }
  const actual = await sha256OfFile(file);
  if (actual !== expected.toLowerCase()) {
    await rm(file, { force: true });
    throw new Error(
      `Checksum verification failed for ${name} (expected ${expected}, got ${actual})`,
    );
  }
};

const sha256OfFile = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
