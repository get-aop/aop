import { describe, expect, test } from "bun:test";
import { isCliUpdateAvailable, parseCliVersion } from "./version.ts";

describe("parseCliVersion", () => {
  test("reads the version out of what each CLI prints for --version", () => {
    expect(parseCliVersion("2.1.286 (Claude Code)\n")).toBe("2.1.286");
    expect(parseCliVersion("codex-cli 0.46.0")).toBe("0.46.0");
    expect(parseCliVersion("v1.2.3")).toBe("1.2.3");
    expect(parseCliVersion("pi version 10.20.30")).toBe("10.20.30");
  });

  test("drops a pre-release or build suffix", () => {
    expect(parseCliVersion("2.2.0-beta.1 (Claude Code)")).toBe("2.2.0");
    expect(parseCliVersion("1.0.0+abc123")).toBe("1.0.0");
  });

  test("finds nothing in output without an x.y.z", () => {
    expect(parseCliVersion("")).toBeNull();
    expect(parseCliVersion("command not found: claude")).toBeNull();
    expect(parseCliVersion("2.1 (Claude Code)")).toBeNull();
  });

  test("does not read a version out of a longer dotted number", () => {
    expect(parseCliVersion("build 1.2.3.4")).toBeNull();
  });
});

describe("isCliUpdateAvailable", () => {
  test("compares major, minor and patch as numbers, not text", () => {
    expect(isCliUpdateAvailable("2.1.10", "2.1.9")).toBe(true);
    expect(isCliUpdateAvailable("2.10.0", "2.9.99")).toBe(true);
    expect(isCliUpdateAvailable("3.0.0", "2.99.99")).toBe(true);
  });

  test("an equal or older published version is no update", () => {
    expect(isCliUpdateAvailable("2.1.286", "2.1.286")).toBe(false);
    expect(isCliUpdateAvailable("2.1.285", "2.1.286")).toBe(false);
  });

  test("an unknown installed or published version is never an update", () => {
    expect(isCliUpdateAvailable(null, "2.1.286")).toBe(false);
    expect(isCliUpdateAvailable("2.1.287", null)).toBe(false);
    expect(isCliUpdateAvailable("garbage", "2.1.286")).toBe(false);
  });
});
