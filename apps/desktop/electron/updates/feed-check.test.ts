import { describe, expect, test } from "bun:test";
import { checkForNewerRelease } from "./feed-check";

const digest = "b".repeat(64);
const release = (version: string, dmgs = ["arm64", "x64"]) => ({
  schemaVersion: 1,
  version,
  publishedAt: "2026-10-02T00:00:00Z",
  notes: "notes",
  notesUrl: `https://getaop.com/releases/v${version}.md`,
  files: dmgs.map((arch) => ({
    name: `aop-macos-${arch}.dmg`,
    kind: "desktop",
    os: "macos",
    arch,
    url: `https://getaop.com/v${version}/aop-macos-${arch}.dmg`,
    sha256: digest,
    size: 1,
  })),
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
  test("reads getaop.com by default", async () => {
    const { fetch, urls } = feed(release("0.10.5"));

    await checkForNewerRelease({ fetch, appVersion: "0.10.4", arch: "arm64" });

    expect(urls).toEqual(["https://getaop.com/releases/latest.json"]);
  });

  test("offers the DMG for this Mac's architecture when the release is newer", async () => {
    const { fetch, urls } = feed(release("0.10.5"));

    const newer = await checkForNewerRelease({
      fetch,
      appVersion: "0.10.4",
      arch: "x64",
      feedOrigin: "http://127.0.0.1:9",
    });

    expect(newer).toEqual({
      version: "0.10.5",
      releaseUrl: "https://getaop.com/releases/v0.10.5.md",
      downloadUrl: "https://getaop.com/v0.10.5/aop-macos-x64.dmg",
    });
    expect(urls).toEqual(["http://127.0.0.1:9/releases/latest.json"]);
  });

  test("falls back to the release notes when the release has no DMG", async () => {
    const { fetch } = feed(release("0.10.5", []));

    const newer = await checkForNewerRelease({ fetch, appVersion: "0.10.4", arch: "arm64" });

    expect(newer?.downloadUrl).toBeNull();
    expect(newer?.releaseUrl).toContain("v0.10.5");
  });

  test("reports nothing for the same or an older release", async () => {
    for (const version of ["0.9.51", "0.9.0"]) {
      const { fetch } = feed(release(version));
      expect(
        await checkForNewerRelease({ fetch, appVersion: "0.9.51+abc1234", arch: "arm64" }),
      ).toBeNull();
    }
  });

  test("throws when the feed answers with an error", async () => {
    const { fetch } = feed({ message: "not found" }, 404);

    await expect(
      checkForNewerRelease({ fetch, appVersion: "0.9.51", arch: "arm64" }),
    ).rejects.toThrow("404");
  });
});
