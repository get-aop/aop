import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fetchLatestRelease } from "./release-feed.ts";
import { stageRelease } from "./stage.ts";
import { swapIn } from "./swap.ts";
import {
  BINARY_ASSET,
  createInstall,
  FAKE_TOKEN,
  localStageTools,
  PLATFORM,
  startFakeRelease,
} from "./test-utils.ts";

const releaseOf = async (options: Parameters<typeof startFakeRelease>[0]) => {
  const fake = await startFakeRelease(options);
  const release = await fetchLatestRelease({
    origin: fake.url,
    channel: "stable" as const,
    github: null,
  });
  return { fake, release };
};

describe("stageRelease", () => {
  test("downloads, checks and unpacks a release beside the install without changing it", async () => {
    const layout = await createInstall("0.9.51");
    const { fake, release } = await releaseOf({ version: "0.10.0" });

    const staged = await stageRelease(release, PLATFORM, layout, localStageTools());

    expect(staged.dir.startsWith(layout.installDir)).toBe(true);
    expect((await stat(staged.binary)).mode & 0o111).not.toBe(0);
    expect(await readFile(join(staged.dashboard, "index.html"), "utf8")).toBe("dashboard 0.10.0");
    expect(await readFile(join(layout.dashboardDir, "index.html"), "utf8")).toBe(
      "dashboard 0.9.51",
    );
    fake.stop();
  });

  test("checks the files against the feed's digests, without fetching checksums.sha256", async () => {
    const layout = await createInstall("0.9.51");
    const { fake, release } = await releaseOf({ version: "0.10.0" });

    await stageRelease(release, PLATFORM, layout, localStageTools());

    expect(fake.requests.some((line) => line.includes("checksums.sha256"))).toBe(false);
    fake.stop();
  });

  test("a binary that does not match the feed's digest is refused and the install is untouched", async () => {
    const layout = await createInstall("0.9.51");
    const { fake, release } = await releaseOf({ version: "0.10.0", corruptBinary: true });

    await expect(stageRelease(release, PLATFORM, layout, localStageTools())).rejects.toThrow(
      `Checksum verification failed for ${BINARY_ASSET}`,
    );

    expect((await readdir(layout.installDir)).sort()).toEqual(["aop", "dashboard"]);
    expect(await readFile(layout.binaryPath, "utf8")).toContain("0.9.51");
    fake.stop();
  });

  test("a GitHub release, which lists no digests, is checked against its checksums.sha256", async () => {
    const layout = await createInstall("0.9.51");
    const fake = await startFakeRelease({ version: "0.10.0", feedDown: true, corruptBinary: true });
    const github = { apiUrl: fake.url, repo: "get-aop/aop-mono", token: FAKE_TOKEN };
    const release = await fetchLatestRelease({
      origin: fake.url,
      channel: "stable" as const,
      github,
    });

    await expect(stageRelease(release, PLATFORM, layout, localStageTools())).rejects.toThrow(
      `Checksum verification failed for ${BINARY_ASSET}`,
    );

    expect(fake.requests).toContain(`/api/assets/checksums.sha256 Bearer ${FAKE_TOKEN}`);
    fake.stop();
  });

  test("names the asset a release is missing", async () => {
    const layout = await createInstall("0.9.51");
    const { fake, release } = await releaseOf({ version: "0.10.0" });
    delete release.assets["aop-darwin-arm64"];

    await expect(stageRelease(release, PLATFORM, layout, localStageTools())).rejects.toThrow(
      "Release 0.10.0 has no aop-darwin-arm64",
    );

    expect((await readdir(layout.installDir)).sort()).toEqual(["aop", "dashboard"]);
    fake.stop();
  });

  test("refuses a binary that reports a different release than the one published", async () => {
    const layout = await createInstall("0.9.51");
    const { fake, release } = await releaseOf({ version: "0.10.0" });
    const tools = localStageTools();
    tools.probeVersion = async () => "0.9.9+abc";

    await expect(stageRelease(release, PLATFORM, layout, tools)).rejects.toThrow(
      'reports version "0.9.9+abc", not 0.10.0',
    );
    fake.stop();
  });

  test("says when the install folder cannot be written", async () => {
    const layout = await createInstall("0.9.51");
    const { fake, release } = await releaseOf({ version: "0.10.0" });
    const unwritable = { ...layout, installDir: join(layout.installDir, "missing", "deeper") };

    await expect(stageRelease(release, PLATFORM, unwritable, localStageTools())).rejects.toThrow(
      "Cannot write to",
    );
    fake.stop();
  });
});

describe("swapIn", () => {
  test("keeps the previous files until committed, and rollback restores them", async () => {
    const layout = await createInstall("0.9.51");
    const { fake, release } = await releaseOf({ version: "0.10.0" });
    const staged = await stageRelease(release, PLATFORM, layout, localStageTools());

    const swapped = await swapIn(staged, layout);

    expect(await readFile(join(layout.dashboardDir, "index.html"), "utf8")).toBe(
      "dashboard 0.10.0",
    );
    expect(existsSync(`${layout.binaryPath}.previous`)).toBe(true);
    expect(existsSync(`${layout.dashboardDir}.previous`)).toBe(true);

    await swapped.rollback();

    expect(await readFile(join(layout.dashboardDir, "index.html"), "utf8")).toBe(
      "dashboard 0.9.51",
    );
    expect(await readFile(layout.binaryPath, "utf8")).toContain("0.9.51");
    expect((await readdir(layout.installDir)).sort()).toEqual(["aop", "dashboard"]);
    fake.stop();
  });

  test("commit drops the old files", async () => {
    const layout = await createInstall("0.9.51");
    const { fake, release } = await releaseOf({ version: "0.10.0" });
    const staged = await stageRelease(release, PLATFORM, layout, localStageTools());

    await (await swapIn(staged, layout)).commit();

    expect(await readFile(layout.binaryPath, "utf8")).toContain("0.10.0");
    expect((await readdir(layout.installDir)).sort()).toEqual(["aop", "dashboard"]);
    fake.stop();
  });
});
