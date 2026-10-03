import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CUA_DRIVER_VERSION,
  parseGithubRelease,
  parseReleaseFeed,
  ReleaseFeedSchema,
} from "@aop/common";
import { generateReleaseChecksums } from "./checksums.ts";
import { writeLatestMacYml } from "./macos-updater.ts";
import {
  absoluteUpdaterUrls,
  buildFeedDocuments,
  buildReleaseFeed,
  githubCompatKey,
  writeFeedDocuments,
} from "./release-feed.ts";

const ORIGIN = "https://getaop.test";
const ARTIFACTS = [
  "aop-darwin-arm64",
  "aop-darwin-x64",
  "aop-linux-arm64",
  "aop-linux-x64",
  "aop-macos-arm64.dmg",
  "aop-macos-x64.dmg",
  "aop-windows-x64-setup.exe",
  "runtime-assets.tar.gz",
];
const LATEST_YML = `version: 0.10.5
files:
  - url: aop-windows-x64-setup.exe
    sha512: abc==
    size: 12
path: aop-windows-x64-setup.exe
sha512: abc==
releaseDate: '2026-10-01T00:00:00.000Z'
`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const releaseDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "aop-feed-"));
  dirs.push(dir);
  for (const name of ARTIFACTS) await writeFile(join(dir, name), `contents of ${name}`);
  await writeFile(join(dir, "latest.yml"), LATEST_YML);
  await generateReleaseChecksums(dir);
  return dir;
};

const input = (dir: string) => ({
  releaseDir: dir,
  version: "0.10.5",
  notes: "## What's Changed\n* Feed on getaop.com",
  publishedAt: "2026-10-02T10:00:00Z",
  origin: ORIGIN,
});

describe("buildReleaseFeed", () => {
  test("lists every file with its platform, public URL, sha256 and size", async () => {
    const dir = await releaseDir();

    const feed = await buildReleaseFeed(input(dir));

    expect(ReleaseFeedSchema.parse(feed)).toEqual(feed);
    expect(feed.version).toBe("0.10.5");
    expect(feed.cuaDriver).toBe(CUA_DRIVER_VERSION);
    expect((await buildReleaseFeed({ ...input(dir), cuaDriver: "0.33.0" })).cuaDriver).toBe(
      "0.33.0",
    );
    expect(feed.notesUrl).toBe(`${ORIGIN}/releases/v0.10.5.md`);
    expect(feed.files.map((file) => file.name).sort()).toEqual(
      [...ARTIFACTS, "checksums.sha256"].sort(),
    );
    const host = feed.files.find((file) => file.name === "aop-darwin-arm64");
    expect(host).toEqual({
      name: "aop-darwin-arm64",
      kind: "host",
      os: "darwin",
      arch: "arm64",
      url: `${ORIGIN}/v0.10.5/aop-darwin-arm64`,
      sha256: new Bun.CryptoHasher("sha256").update("contents of aop-darwin-arm64").digest("hex"),
      size: "contents of aop-darwin-arm64".length,
    });
    expect(feed.files.find((file) => file.name === "aop-windows-x64-setup.exe")).toMatchObject({
      kind: "desktop",
      os: "windows",
      arch: "x64",
    });
    expect(feed.files.find((file) => file.name === "runtime-assets.tar.gz")?.kind).toBe(
      "runtime-assets",
    );
  });

  test("refuses a file that does not match checksums.sha256", async () => {
    const dir = await releaseDir();
    await writeFile(join(dir, "aop-linux-x64"), "changed after the checksums were taken");

    await expect(buildReleaseFeed(input(dir))).rejects.toThrow(
      "aop-linux-x64 does not match its line in checksums.sha256",
    );
  });
});

describe("buildFeedDocuments", () => {
  test("the feed reads back as the release the host and the apps update to", async () => {
    const dir = await releaseDir();
    const docs = await buildFeedDocuments(input(dir));

    const release = parseReleaseFeed(JSON.parse(docs.pointers["releases/latest.json"] ?? ""));

    expect(release?.version).toBe("0.10.5");
    expect(release?.notes).toContain("Feed on getaop.com");
    expect(release?.assets["aop-darwin-arm64"]?.url).toBe(`${ORIGIN}/v0.10.5/aop-darwin-arm64`);
    expect(release?.assets["aop-darwin-arm64"]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(docs.versioned["releases/v0.10.5.json"]).toBe(docs.pointers["releases/latest.json"]);
    expect(docs.versioned["releases/v0.10.5.md"]).toBe(input(dir).notes);
  });

  test("the GitHub-shaped copy is what AOP 0.10.0 to 0.10.4 parse, at the path they ask for", async () => {
    const dir = await releaseDir();
    const docs = await buildFeedDocuments(input(dir));

    expect(githubCompatKey()).toBe("repos/get-aop/aop-mono/releases/latest");
    const release = parseGithubRelease(JSON.parse(docs.pointers[githubCompatKey()] ?? ""));

    expect(release?.version).toBe("0.10.5");
    expect(release?.url).toBe(`${ORIGIN}/releases/v0.10.5.md`);
    expect(release?.assets["checksums.sha256"]?.url).toBe(`${ORIGIN}/v0.10.5/checksums.sha256`);
    expect(release?.assets["runtime-assets.tar.gz"]?.url).toBe(
      `${ORIGIN}/v0.10.5/runtime-assets.tar.gz`,
    );
  });

  test("the Windows latest.yml under latest/ names the versioned installer", async () => {
    const dir = await releaseDir();
    const out = await mkdtemp(join(tmpdir(), "aop-feed-out-"));
    dirs.push(out);

    await writeFeedDocuments(await buildFeedDocuments(input(dir)), out);

    const yml = await readFile(join(out, "latest", "latest.yml"), "utf8");
    expect(yml).toContain(`  - url: ${ORIGIN}/v0.10.5/aop-windows-x64-setup.exe\n`);
    expect(yml).toContain(`path: ${ORIGIN}/v0.10.5/aop-windows-x64-setup.exe\n`);
    expect(yml).toContain("sha512: abc==");
    for (const key of [
      "releases/latest.json",
      "releases/v0.10.5.json",
      "releases/v0.10.5.md",
      "repos/get-aop/aop-mono/releases/latest",
    ]) {
      expect(await Bun.file(join(out, key)).exists()).toBe(true);
    }
  });

  test("a release without the Windows app has no latest.yml pointer", async () => {
    const dir = await releaseDir();
    await rm(join(dir, "latest.yml"));

    const docs = await buildFeedDocuments(input(dir));

    expect(Object.keys(docs.pointers)).not.toContain("latest/latest.yml");
  });

  test("the macOS latest-mac.yml under latest/ names the versioned zips of both architectures", async () => {
    const dir = await releaseDir();
    await writeFile(join(dir, "aop-macos-x64.zip"), "intel app");
    await writeFile(join(dir, "aop-macos-arm64.zip"), "apple silicon app");
    await writeLatestMacYml(dir, "0.10.5");

    const docs = await buildFeedDocuments(input(dir));
    const yml = docs.pointers["latest/latest-mac.yml"] ?? "";

    expect(yml).toContain(`  - url: ${ORIGIN}/v0.10.5/aop-macos-x64.zip\n`);
    expect(yml).toContain(`  - url: ${ORIGIN}/v0.10.5/aop-macos-arm64.zip\n`);
    expect(yml).toContain(`path: ${ORIGIN}/v0.10.5/aop-macos-x64.zip\n`);
    expect(yml).toStartWith("version: 0.10.5\n");
  });

  test("a release without the macOS zips has no latest-mac.yml pointer", async () => {
    const docs = await buildFeedDocuments(input(await releaseDir()));

    expect(Object.keys(docs.pointers)).not.toContain("latest/latest-mac.yml");
  });
});

describe("absoluteUpdaterUrls", () => {
  test("leaves absolute and quoted values right", () => {
    const yml = "path: 'aop-setup.exe'\nfiles:\n  - url: https://cdn/x.exe\n";
    expect(absoluteUpdaterUrls(yml, "https://o/v1.0.0/")).toBe(
      "path: https://o/v1.0.0/aop-setup.exe\nfiles:\n  - url: https://cdn/x.exe\n",
    );
  });
});

describe("nightly feed", () => {
  test("lives under its own origin, names its commit and has no GitHub-shaped copy", async () => {
    const dir = await releaseDir();
    await rm(join(dir, "latest.yml"));
    const version = "0.10.7-nightly.20261002.14";
    const docs = await buildFeedDocuments({
      ...input(dir),
      version,
      origin: "https://getaop.test/nightly",
      channel: "nightly",
      commit: "c2133573",
    });

    expect(Object.keys(docs.versioned).sort()).toEqual([
      `releases/v${version}.json`,
      `releases/v${version}.md`,
    ]);
    expect(Object.keys(docs.pointers)).toEqual(["releases/latest.json"]);
    const feed = ReleaseFeedSchema.parse(JSON.parse(docs.pointers["releases/latest.json"] ?? ""));
    expect(feed).toMatchObject({ version, commit: "c2133573", channel: "nightly" });
    expect(feed.files[0]?.url).toStartWith(`https://getaop.test/nightly/v${version}/`);
    expect(parseReleaseFeed(feed, "nightly")?.version).toBe(version);
    // A stable reader never takes it, even if it were served at the stable path.
    expect(parseReleaseFeed(feed)).toBeNull();
  });
});
