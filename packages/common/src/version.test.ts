import { describe, expect, test } from "bun:test";
import { compareReleaseVersions, isNewerRelease, normalizeReleaseVersion } from "./version.ts";

describe("release comparison", () => {
  test("orders by major, minor and patch, ignoring prefix and build metadata", () => {
    expect(compareReleaseVersions("0.10.0", "0.9.51")).toBeGreaterThan(0);
    expect(compareReleaseVersions("v0.9.51+abc1234", "0.9.51")).toBe(0);
    expect(compareReleaseVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  test("a build that is not a release is never reported as older than a release", () => {
    expect(isNewerRelease("0.10.0", "dev")).toBe(false);
    expect(isNewerRelease("0.10.0", "0.9.51+abc1234")).toBe(true);
    expect(isNewerRelease("0.9.51", "0.9.51")).toBe(false);
  });
});

describe("version", () => {
  test("normalizes build metadata and v-prefix", () => {
    expect(normalizeReleaseVersion("v0.1.0+abc123")).toBe("0.1.0");
    expect(normalizeReleaseVersion("0.2.0-beta.1")).toBe("0.2.0");
  });

  test("normalizes shorthand versions to three parts", () => {
    expect(normalizeReleaseVersion("20")).toBe("20.0.0");
    expect(normalizeReleaseVersion("v18.2")).toBe("18.2.0");
  });
});
