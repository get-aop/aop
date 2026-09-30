import { describe, expect, test } from "bun:test";
import { normalizeReleaseVersion } from "./version.ts";

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
