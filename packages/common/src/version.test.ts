import { describe, expect, test } from "bun:test";
import {
  compareReleaseVersions,
  isChannelVersion,
  isNewerBuild,
  isNewerRelease,
  isNightlyVersion,
  isReleaseVersion,
  normalizeReleaseVersion,
} from "./version.ts";

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

describe("nightly versions", () => {
  const nightly = "0.10.7-nightly.20261002.14";

  test("keep their pre-release part and drop build metadata", () => {
    expect(normalizeReleaseVersion(`v${nightly}+c213357`)).toBe(nightly);
    expect(isNightlyVersion(`${nightly}+c213357`)).toBe(true);
    expect(isNightlyVersion("0.10.7")).toBe(false);
  });

  test("order by core, then date, then run, and sit below the release they preview", () => {
    expect(compareReleaseVersions("0.10.7-nightly.20261002.15", nightly)).toBeGreaterThan(0);
    expect(compareReleaseVersions("0.10.7-nightly.20261003.1", nightly)).toBeGreaterThan(0);
    expect(compareReleaseVersions("0.10.8-nightly.20261001.1", nightly)).toBeGreaterThan(0);
    expect(compareReleaseVersions(nightly, "0.10.7")).toBeLessThan(0);
    expect(compareReleaseVersions(nightly, "0.10.6")).toBeGreaterThan(0);
  });

  test("are never a stable release, so a stable install is never offered one", () => {
    expect(isReleaseVersion(nightly)).toBe(false);
    expect(isNewerRelease(nightly, "0.10.6")).toBe(false);
    expect(isNewerBuild(nightly, "0.10.6", "stable")).toBe(false);
  });

  test("a nightly install moves only to a newer nightly", () => {
    expect(isNewerBuild("0.10.7-nightly.20261002.15", `${nightly}+abc`, "nightly")).toBe(true);
    expect(isNewerBuild(nightly, nightly, "nightly")).toBe(false);
    expect(isNewerBuild("0.10.7", nightly, "nightly")).toBe(false);
    expect(isNewerBuild(nightly, "dev", "nightly")).toBe(false);
    expect(isChannelVersion("0.10.7", "stable")).toBe(true);
  });
});
