import { describe, expect, test } from "bun:test";
import { compareHostToApp, hostVersionNotice } from "./host-version";

describe("compareHostToApp", () => {
  test("orders release versions and ignores build metadata", () => {
    expect(compareHostToApp("0.10.0+abc1234", "0.9.51")).toBe("newer");
    expect(compareHostToApp("0.9.0", "0.9.51")).toBe("older");
    expect(compareHostToApp("0.9.51+abc1234", "0.9.51")).toBe("same");
  });

  test("says nothing when either side is not a release", () => {
    expect(compareHostToApp("dev", "0.9.51")).toBe("unknown");
    expect(compareHostToApp("0.9.51", "dev")).toBe("unknown");
  });
});

describe("hostVersionNotice", () => {
  test("tells the person which side to update", () => {
    expect(hostVersionNotice("0.10.0+abc1234", "0.9.51")).toBe(
      "The host (0.10.0) is newer than this app (0.9.51). Update the app.",
    );
    expect(hostVersionNotice("0.9.0", "0.10.0")).toBe(
      'The host (0.9.0) is older than this app (0.10.0). Update the host with "aop update".',
    );
  });

  test("has no line when the releases match or cannot be compared", () => {
    expect(hostVersionNotice("0.9.51", "0.9.51")).toBeNull();
    expect(hostVersionNotice("dev", "0.9.51")).toBeNull();
  });
});
