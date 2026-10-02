import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLatestMacYml,
  checkLatestMacYml,
  MAC_UPDATER_FILES,
  writeLatestMacYml,
} from "./macos-updater.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A release folder holding a zip per architecture. */
const releaseWithZips = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "aop-macos-updater-"));
  dirs.push(dir);
  await writeFile(join(dir, "aop-macos-x64.zip"), "intel app");
  await writeFile(join(dir, "aop-macos-arm64.zip"), "apple silicon app");
  return dir;
};

const sha512 = (text: string): string =>
  new Bun.CryptoHasher("sha512").update(text).digest("base64");

describe("macOS updater files", () => {
  test("ship latest-mac.yml and one zip per architecture", () => {
    expect(MAC_UPDATER_FILES).toEqual([
      "latest-mac.yml",
      "aop-macos-x64.zip",
      "aop-macos-arm64.zip",
    ]);
  });

  test("latest-mac.yml names both zips with their sha512 and size, as electron-updater reads it", async () => {
    const dir = await releaseWithZips();
    await writeLatestMacYml(dir, "0.10.5", "2026-10-01T00:00:00.000Z");

    const parsed = Bun.YAML.parse(await Bun.file(join(dir, "latest-mac.yml")).text());
    expect(parsed).toEqual({
      version: "0.10.5",
      files: [
        { url: "aop-macos-x64.zip", sha512: sha512("intel app"), size: 9 },
        { url: "aop-macos-arm64.zip", sha512: sha512("apple silicon app"), size: 17 },
      ],
      path: "aop-macos-x64.zip",
      sha512: sha512("intel app"),
      releaseDate: "2026-10-01T00:00:00.000Z",
    });
  });

  test("only the arm64 zip's name says arm64, which is how electron-updater picks per Mac", () => {
    const yml = buildLatestMacYml(
      "1.0.0",
      [
        { name: "aop-macos-x64.zip", sha512: "a", size: 1 },
        { name: "aop-macos-arm64.zip", sha512: "b", size: 2 },
      ],
      "2026-10-01T00:00:00.000Z",
    );
    const urls = yml.match(/^ {2}- url: .*$/gm) ?? [];
    expect(urls.filter((line) => line.includes("arm64"))).toEqual(["  - url: aop-macos-arm64.zip"]);
  });

  test("writing fails without both zips", async () => {
    const dir = await releaseWithZips();
    await rm(join(dir, "aop-macos-arm64.zip"));
    await expect(writeLatestMacYml(dir, "0.10.5")).rejects.toThrow("Missing macOS update zip");
  });

  test("the check passes for the file this run wrote", async () => {
    const dir = await releaseWithZips();
    await writeLatestMacYml(dir, "0.10.5");
    await expect(checkLatestMacYml(dir, "0.10.5")).resolves.toBeUndefined();
  });

  test("the check fails on another version, a missing zip entry or a changed zip", async () => {
    const dir = await releaseWithZips();
    await writeLatestMacYml(dir, "0.10.5");
    await expect(checkLatestMacYml(dir, "0.10.6")).rejects.toThrow("is for 0.10.5, not 0.10.6");

    await writeFile(join(dir, "aop-macos-arm64.zip"), "another build");
    await expect(checkLatestMacYml(dir, "0.10.5")).rejects.toThrow(
      "does not match aop-macos-arm64.zip",
    );

    const yml = await Bun.file(join(dir, "latest-mac.yml")).text();
    await writeFile(join(dir, "latest-mac.yml"), yml.replaceAll("aop-macos-arm64.zip", "x.zip"));
    await expect(checkLatestMacYml(dir, "0.10.5")).rejects.toThrow(
      "does not list aop-macos-arm64.zip",
    );
  });

  test("the check fails when latest-mac.yml is missing", async () => {
    const dir = await releaseWithZips();
    await expect(checkLatestMacYml(dir, "0.10.5")).rejects.toThrow("latest-mac.yml is missing");
  });
});
