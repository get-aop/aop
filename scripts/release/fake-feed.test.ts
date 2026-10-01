import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGithubRelease, parseReleaseFeed } from "@aop/common";
import { type FakeFeed, startFakeFeed } from "./fake-feed.ts";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0)) await step();
});

const start = async (): Promise<FakeFeed> => {
  const dir = await mkdtemp(join(tmpdir(), "aop-fake-feed-"));
  await writeFile(join(dir, "aop-darwin-arm64"), "binary");
  await writeFile(join(dir, "runtime-assets.tar.gz"), "assets");
  const feed = await startFakeFeed({ dir, version: "99.0.0" });
  cleanup.push(feed.stop, () => rm(dir, { recursive: true, force: true }));
  return feed;
};

describe("startFakeFeed", () => {
  test("serves the feed deploy-r2.sh publishes, and the files it names", async () => {
    const feed = await start();

    const release = parseReleaseFeed(
      await (await fetch(`${feed.url}/releases/latest.json`)).json(),
    );
    const binary = release?.assets["aop-darwin-arm64"];

    expect(release?.version).toBe("99.0.0");
    expect(binary?.url).toBe(`${feed.url}/v99.0.0/aop-darwin-arm64`);
    expect(await (await fetch(binary?.url ?? "")).text()).toBe("binary");
    expect(release?.assets["checksums.sha256"]).toBeDefined();
    expect(await (await fetch(`${feed.url}/releases/v99.0.0.md`)).text()).toContain("99.0.0");
  });

  test("serves the GitHub-shaped copy that AOP 0.10.0 to 0.10.4 read", async () => {
    const feed = await start();

    const response = await fetch(`${feed.url}/repos/get-aop/aop-mono/releases/latest`);

    expect(parseGithubRelease(await response.json())?.version).toBe("99.0.0");
    expect((await fetch(`${feed.url}/v99.0.0/missing`)).status).toBe(404);
  });
});
