import { describe, expect, test } from "bun:test";
import { bumpSemver, resolveNextReleaseVersion } from "./semver.ts";

describe("semver", () => {
  test("bumps patch, minor, and major versions", () => {
    expect(bumpSemver("0.1.0", "patch")).toBe("0.1.1");
    expect(bumpSemver("0.1.9", "minor")).toBe("0.2.0");
    expect(bumpSemver("1.4.2", "major")).toBe("2.0.0");
  });

  test("resolves explicit versions and bump keywords", () => {
    expect(resolveNextReleaseVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(resolveNextReleaseVersion("0.1.0", "v0.2.0")).toBe("0.2.0");
  });
});
