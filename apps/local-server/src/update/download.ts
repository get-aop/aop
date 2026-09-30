import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { CHECKSUMS_NAME, type FetchFn, messageOf } from "./release-feed.ts";

/** Saves `url` to `path`. Assets are large, so the body is streamed to disk, not held in memory. */
export const downloadAsset = async (
  name: string,
  url: string,
  path: string,
  fetchFn: FetchFn,
): Promise<void> => {
  let response: Response;
  try {
    response = await fetchFn(url);
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

/**
 * Checks `file` against its line in `checksums.sha256` (`<hex>  <name>`, what install.sh reads).
 * A missing line fails as firmly as a wrong digest: an unlisted file is an unverified one. The
 * file is deleted on failure so it can never be installed by mistake.
 */
export const verifyChecksum = async (
  checksums: string,
  name: string,
  file: string,
): Promise<void> => {
  const expected = expectedDigest(checksums, name);
  if (!expected) {
    await rm(file, { force: true });
    throw new Error(`No checksum for ${name} in ${CHECKSUMS_NAME}`);
  }
  const actual = await sha256OfFile(file);
  if (actual !== expected) {
    await rm(file, { force: true });
    throw new Error(
      `Checksum verification failed for ${name} (expected ${expected}, got ${actual})`,
    );
  }
};

const expectedDigest = (checksums: string, name: string): string | null => {
  for (const line of checksums.split("\n")) {
    const [digest, listed] = line.trim().split(/\s+/);
    if (listed === name && digest) return digest.toLowerCase();
  }
  return null;
};

const sha256OfFile = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
