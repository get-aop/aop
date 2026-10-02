import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CHANNELS } from "@aop/common";
import { downloadAsset } from "./download.ts";
import { downloadFetch, feedConfigFromEnv, fetchLatestRelease } from "./release-feed.ts";
import { BINARY_ASSET, FAKE_TOKEN, scratchDir, serve, startFakeRelease } from "./test-utils.ts";

const noGithub = (origin: string) => ({ origin, channel: "stable" as const, github: null });

describe("feedConfigFromEnv", () => {
  test("reads getaop.com, with no GitHub fallback unless a token is set", () => {
    expect(feedConfigFromEnv({})).toEqual({ origin: "https://getaop.com", channel: "stable" as const, github: null });
    expect(feedConfigFromEnv({ AOP_RELEASE_FEED_URL: "http://127.0.0.1:9" }).origin).toBe(
      "http://127.0.0.1:9",
    );
  });

  test("a nightly host reads the nightly feed and never falls back to GitHub", () => {
    expect(feedConfigFromEnv({ GH_TOKEN: "gh" }, CHANNELS.nightly)).toEqual({
      origin: "https://getaop.com/nightly",
      channel: "nightly",
      github: null,
    });
  });

  test("a nightly host takes a nightly from its feed and refuses a stable release", async () => {
    const nightly = await startFakeRelease({ version: "0.10.7-nightly.20261002.14" });
    const stable = await startFakeRelease({ version: "0.10.7" });
    try {
      const config = (origin: string) => ({ origin, channel: "nightly" as const, github: null });
      expect((await fetchLatestRelease(config(nightly.url))).version).toBe(
        "0.10.7-nightly.20261002.14",
      );
      await expect(fetchLatestRelease(config(stable.url))).rejects.toThrow(
        "did not describe a published release",
      );
      await expect(fetchLatestRelease(noGithub(nightly.url))).rejects.toThrow(
        "did not describe a published release",
      );
    } finally {
      nightly.stop();
      stable.stop();
    }
  });

  test("a token turns on the GitHub fallback, which the old variables still point", () => {
    expect(
      feedConfigFromEnv({
        GH_TOKEN: "gh",
        AOP_GITHUB_API_URL: "http://x",
        AOP_GITHUB_REPO: "a/b",
      }).github,
    ).toEqual({ apiUrl: "http://x", repo: "a/b", token: "gh" });
    expect(feedConfigFromEnv({ GITHUB_TOKEN: "env", AOP_GITHUB_TOKEN: "aop" }).github).toEqual({
      apiUrl: "https://api.github.com",
      repo: "get-aop/aop",
      token: "aop",
    });
  });
});

describe("fetchLatestRelease", () => {
  test("reads the version, the notes and each file's URL and sha256 from the feed", async () => {
    const fake = await startFakeRelease({ version: "0.10.5" });

    const release = await fetchLatestRelease(noGithub(fake.url));

    expect(release.version).toBe("0.10.5");
    expect(release.url).toBe(`${fake.url}/releases/v0.10.5.md`);
    expect(release.notes).toBe("Notes of 0.10.5");
    expect(release.assets[BINARY_ASSET]?.url).toBe(`${fake.url}/v0.10.5/${BINARY_ASSET}`);
    expect(release.assets[BINARY_ASSET]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    fake.stop();
  });

  test("turns a feed that answers badly into a message", async () => {
    const down = serve(() => new Response("nope", { status: 403 }));
    const junk = serve(() => Response.json({ hello: "world" }));
    const older = serve(() => Response.json({ schemaVersion: 2, version: "1.0.0" }));

    await expect(fetchLatestRelease(noGithub(down.url))).rejects.toThrow(
      `The release feed answered 403 for ${down.url}/releases/latest.json`,
    );
    await expect(fetchLatestRelease(noGithub(junk.url))).rejects.toThrow(
      "did not describe a published release",
    );
    await expect(fetchLatestRelease(noGithub(older.url))).rejects.toThrow(
      "did not describe a published release",
    );
    for (const f of [down, junk, older]) f.stop();
  });

  test("falls back to GitHub with the token when the feed fails, and downloads with it", async () => {
    const fake = await startFakeRelease({ version: "0.10.5", feedDown: true });
    const github = { apiUrl: fake.url, repo: "get-aop/aop-mono", token: FAKE_TOKEN };

    const release = await fetchLatestRelease({ origin: fake.url, channel: "stable" as const, github });
    const asset = release.assets[BINARY_ASSET];
    const dir = await scratchDir("fallback");
    await downloadAsset(BINARY_ASSET, asset ?? { url: "" }, join(dir, "aop"), downloadFetch);

    expect(release.version).toBe("0.10.5");
    expect(asset?.sha256).toBeNull();
    expect(await Bun.file(join(dir, "aop")).text()).toContain("aop/0.10.5");
    // The token goes to the API and the asset address, never to the signed storage.
    expect(fake.requests).toContain(`/api/assets/${BINARY_ASSET} Bearer ${FAKE_TOKEN}`);
    expect(fake.requests).toContain(`/signed/${BINARY_ASSET} -`);
    fake.stop();
  });

  test("without a token a failed feed is the error, and both are named when both fail", async () => {
    const fake = await startFakeRelease({ version: "0.10.5", feedDown: true });

    await expect(fetchLatestRelease(noGithub(fake.url))).rejects.toThrow("answered 404");
    await expect(
      fetchLatestRelease({
        origin: fake.url,
        channel: "stable" as const,
        github: { apiUrl: fake.url, repo: "a/b", token: "wrong" },
      }),
    ).rejects.toThrow(/answered 404 .*releases\/latest\.json \(GitHub fallback: .*answered 404/);
    fake.stop();
  });
});
