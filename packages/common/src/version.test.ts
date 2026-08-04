import { describe, expect, test } from "bun:test";
import {
  compareReleaseVersions,
  isReleaseVersionNewer,
  normalizeReleaseVersion,
} from "./version.ts";

describe("version", () => {
  test("normalizes build metadata and v-prefix", () => {
    expect(normalizeReleaseVersion("v0.1.0+abc123")).toBe("0.1.0");
    expect(normalizeReleaseVersion("0.2.0-beta.1")).toBe("0.2.0");
  });

  test("compares semver cores", () => {
    expect(compareReleaseVersions("0.2.0", "0.1.0")).toBe(1);
    expect(compareReleaseVersions("0.1.0", "0.2.0")).toBe(-1);
    expect(compareReleaseVersions("0.1.0+abc", "0.1.0+def")).toBe(0);
  });

  test("normalizes and compares shorthand versions numerically", () => {
    expect(normalizeReleaseVersion("20")).toBe("20.0.0");
    expect(normalizeReleaseVersion("v18.2")).toBe("18.2.0");
    expect(compareReleaseVersions("20", "9")).toBe(1);
    expect(compareReleaseVersions("18", "18.0.0")).toBe(0);
  });

  test("detects newer releases", () => {
    expect(isReleaseVersionNewer("0.2.0", "0.1.0+commit")).toBe(true);
    expect(isReleaseVersionNewer("0.1.0", "0.1.0+commit")).toBe(false);
    expect(isReleaseVersionNewer("0.1.0", "0.2.0")).toBe(false);
  });
});
