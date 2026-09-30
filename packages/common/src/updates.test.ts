import { describe, expect, test } from "bun:test";
import { latestReleaseApiUrl, parseGithubRelease } from "./updates.ts";

describe("parseGithubRelease", () => {
  test("reads the version, the notes page and the assets by name", () => {
    expect(
      parseGithubRelease({
        tag_name: "v0.10.0",
        html_url: "https://github.com/get-aop/aop-mono/releases/tag/v0.10.0",
        assets: [{ name: "aop-darwin-arm64", browser_download_url: "https://x/aop-darwin-arm64" }],
      }),
    ).toEqual({
      version: "0.10.0",
      url: "https://github.com/get-aop/aop-mono/releases/tag/v0.10.0",
      assets: { "aop-darwin-arm64": "https://x/aop-darwin-arm64" },
    });
  });

  test("refuses drafts, pre-releases and tags that are not versions", () => {
    const base = { tag_name: "v0.10.0", html_url: "https://x" };
    expect(parseGithubRelease({ ...base, draft: true })).toBeNull();
    expect(parseGithubRelease({ ...base, prerelease: true })).toBeNull();
    expect(parseGithubRelease({ ...base, tag_name: "nightly" })).toBeNull();
    expect(parseGithubRelease("nope")).toBeNull();
  });

  test("builds the latest-release URL for a base", () => {
    expect(latestReleaseApiUrl("http://127.0.0.1:9/")).toBe(
      "http://127.0.0.1:9/repos/get-aop/aop-mono/releases/latest",
    );
  });
});
