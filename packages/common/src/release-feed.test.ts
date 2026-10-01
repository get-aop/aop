import { describe, expect, test } from "bun:test";
import {
  describeReleaseFile,
  desktopUpdaterFeedUrl,
  latestReleaseFeedUrl,
  parseReleaseFeed,
  releaseFeedUrl,
} from "./release-feed.ts";

const digest = "a".repeat(64);
const feed = {
  schemaVersion: 1,
  version: "0.10.5",
  publishedAt: "2026-10-02T00:00:00Z",
  notes: "## What's Changed",
  notesUrl: "https://getaop.com/releases/v0.10.5.md",
  files: [
    {
      name: "aop-darwin-arm64",
      kind: "host",
      os: "darwin",
      arch: "arm64",
      url: "https://getaop.com/v0.10.5/aop-darwin-arm64",
      sha256: digest,
      size: 10,
    },
    {
      name: "aop-ios.ipa",
      kind: "mobile",
      url: "https://getaop.com/v0.10.5/aop-ios.ipa",
      sha256: digest,
      size: 1,
      signature: "a field a later release may add",
    },
  ],
};

describe("parseReleaseFeed", () => {
  test("reads the version, notes and each file's URL and sha256", () => {
    expect(parseReleaseFeed(feed)).toEqual({
      version: "0.10.5",
      url: "https://getaop.com/releases/v0.10.5.md",
      notes: "## What's Changed",
      assets: {
        "aop-darwin-arm64": { url: "https://getaop.com/v0.10.5/aop-darwin-arm64", sha256: digest },
        "aop-ios.ipa": { url: "https://getaop.com/v0.10.5/aop-ios.ipa", sha256: digest },
      },
    });
  });

  test("refuses another schema, a version that is not a release, and a file without a sha256", () => {
    expect(parseReleaseFeed({ ...feed, schemaVersion: 2 })).toBeNull();
    expect(parseReleaseFeed({ ...feed, version: "nightly" })).toBeNull();
    const [first] = feed.files;
    expect(parseReleaseFeed({ ...feed, files: [{ ...first, sha256: "abc" }] })).toBeNull();
    expect(parseReleaseFeed("<html>404</html>")).toBeNull();
  });
});

describe("feed addresses", () => {
  test("live under the origin, whatever trailing slash it has", () => {
    expect(latestReleaseFeedUrl()).toBe("https://getaop.com/releases/latest.json");
    expect(latestReleaseFeedUrl("http://127.0.0.1:9/")).toBe(
      "http://127.0.0.1:9/releases/latest.json",
    );
    expect(releaseFeedUrl("0.10.5")).toBe("https://getaop.com/releases/v0.10.5.json");
    expect(desktopUpdaterFeedUrl()).toBe("https://getaop.com/latest/");
  });
});

describe("describeReleaseFile", () => {
  test("names the platform and architecture of each release file", () => {
    expect(describeReleaseFile("aop-linux-x64")).toEqual({
      kind: "host",
      os: "linux",
      arch: "x64",
    });
    expect(describeReleaseFile("aop-macos-arm64.dmg")).toEqual({
      kind: "desktop",
      os: "macos",
      arch: "arm64",
    });
    expect(describeReleaseFile("aop-windows-x64-setup.exe")).toEqual({
      kind: "desktop",
      os: "windows",
      arch: "x64",
    });
    expect(describeReleaseFile("runtime-assets.tar.gz")).toEqual({ kind: "runtime-assets" });
    expect(describeReleaseFile("checksums.sha256")).toEqual({ kind: "checksums" });
  });
});
