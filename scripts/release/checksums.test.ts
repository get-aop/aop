import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateChecksumFile,
  RELEASE_CHECKSUM_ARTIFACTS,
  RELEASE_UPDATER_FILES,
} from "./checksums.ts";

describe("release checksums", () => {
  test("includes the Windows desktop installer but no Windows host binary", () => {
    expect(RELEASE_CHECKSUM_ARTIFACTS).toContain("aop-windows-x64-setup.exe");
    expect(RELEASE_CHECKSUM_ARTIFACTS).not.toContain("aop-windows-x64.exe");
  });

  test("keeps the Windows updater files out of the manifest: latest.yml carries its own sha512", () => {
    for (const name of RELEASE_UPDATER_FILES) {
      expect(RELEASE_CHECKSUM_ARTIFACTS).not.toContain(name);
    }
    expect(RELEASE_UPDATER_FILES).toEqual(["latest.yml", "aop-windows-x64-setup.exe.blockmap"]);
  });

  test("writes checksums for binaries and DMGs using artifact basenames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-release-checksums-"));

    try {
      const binaryPath = join(dir, "aop-darwin-arm64");
      const dmgPath = join(dir, "aop-macos-arm64.dmg");
      await writeFile(binaryPath, "binary");
      await writeFile(dmgPath, "dmg");

      await generateChecksumFile([binaryPath, dmgPath], join(dir, "checksums.sha256"));

      const manifest = await readFile(join(dir, "checksums.sha256"), "utf8");
      expect(manifest).toContain("  aop-darwin-arm64\n");
      expect(manifest).toContain("  aop-macos-arm64.dmg\n");
      expect(manifest).not.toContain(dir);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
