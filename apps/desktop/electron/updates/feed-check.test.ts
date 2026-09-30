import { describe, expect, test } from "bun:test";
import { checkForNewerRelease } from "./feed-check";

const release = (tag: string) => ({
  tag_name: tag,
  html_url: `https://github.com/get-aop/aop-mono/releases/tag/${tag}`,
  assets: [
    { name: "aop-macos-arm64.dmg", browser_download_url: "https://dl/aop-macos-arm64.dmg" },
    { name: "aop-macos-x64.dmg", browser_download_url: "https://dl/aop-macos-x64.dmg" },
  ],
});

const feed = (body: unknown, status = 200) => {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url);
      return Response.json(body, { status });
    },
  };
};

describe("checkForNewerRelease", () => {
  test("offers the DMG for this Mac's architecture when the release is newer", async () => {
    const { fetch, urls } = feed(release("v0.10.0"));

    const newer = await checkForNewerRelease({
      fetch,
      appVersion: "0.9.51",
      arch: "x64",
      apiBase: "http://127.0.0.1:9",
    });

    expect(newer).toEqual({
      version: "0.10.0",
      releaseUrl: "https://github.com/get-aop/aop-mono/releases/tag/v0.10.0",
      downloadUrl: "https://dl/aop-macos-x64.dmg",
    });
    expect(urls).toEqual(["http://127.0.0.1:9/repos/get-aop/aop-mono/releases/latest"]);
  });

  test("falls back to the release page when the release has no DMG", async () => {
    const { fetch } = feed({ ...release("v0.10.0"), assets: [] });

    const newer = await checkForNewerRelease({ fetch, appVersion: "0.9.51", arch: "arm64" });

    expect(newer?.downloadUrl).toBeNull();
    expect(newer?.releaseUrl).toContain("v0.10.0");
  });

  test("reports nothing for the same or an older release", async () => {
    for (const tag of ["v0.9.51", "v0.9.0"]) {
      const { fetch } = feed(release(tag));
      expect(
        await checkForNewerRelease({ fetch, appVersion: "0.9.51+abc1234", arch: "arm64" }),
      ).toBeNull();
    }
  });

  test("throws when the feed answers with an error", async () => {
    const { fetch } = feed({ message: "rate limited" }, 403);

    await expect(
      checkForNewerRelease({ fetch, appVersion: "0.9.51", arch: "arm64" }),
    ).rejects.toThrow("403");
  });
});
