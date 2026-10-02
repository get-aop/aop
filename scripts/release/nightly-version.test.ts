import { describe, expect, test } from "bun:test";
import { compareReleaseVersions } from "@aop/common";
import { nightlyVersion } from "./nightly-version.ts";

describe("nightly version", () => {
  const day = new Date("2026-10-02T23:59:00Z");

  test("is the next patch, the UTC date and the run", () => {
    expect(nightlyVersion("0.10.6", day, 14)).toBe("0.10.7-nightly.20261002.14");
  });

  test("sorts after the release it follows and before the one it previews", () => {
    const version = nightlyVersion("0.10.6", day, 14);
    expect(compareReleaseVersions(version, "0.10.6")).toBeGreaterThan(0);
    expect(compareReleaseVersions(version, "0.10.7")).toBeLessThan(0);
    expect(compareReleaseVersions(nightlyVersion("0.10.6", day, 15), version)).toBeGreaterThan(0);
    // After the 0.10.7 release lands, the next nightly previews 0.10.8.
    expect(compareReleaseVersions(nightlyVersion("0.10.7", day, 16), "0.10.7")).toBeGreaterThan(0);
  });

  test("refuses a run number that would not sort", () => {
    expect(() => nightlyVersion("0.10.6", day, Number.NaN)).toThrow("positive run number");
    expect(() => nightlyVersion("0.10.6", day, 0)).toThrow("positive run number");
  });
});
