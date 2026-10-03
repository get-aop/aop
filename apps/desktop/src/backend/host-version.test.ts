import { describe, expect, test } from "bun:test";
import { appBehindHostNote, compareHostToApp, hostBehindAppNote } from "./host-version";

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

describe("version drift notes", () => {
  test("the app row says when the host is newer, naming the host", () => {
    expect(appBehindHostNote("soulf", "0.10.0+abc1234", "0.9.51")).toBe(
      "soulf runs 0.10.0; this app is older",
    );
    expect(appBehindHostNote("soulf", "0.9.0", "0.10.0")).toBeNull();
  });

  test("the host says when it is older than the app", () => {
    expect(hostBehindAppNote("0.9.0", "0.10.0")).toBe("Older than this app");
    expect(hostBehindAppNote("0.10.0", "0.9.0")).toBeNull();
  });

  test("say nothing when the releases match or cannot be compared", () => {
    expect(appBehindHostNote("soulf", "0.9.51", "0.9.51")).toBeNull();
    expect(hostBehindAppNote("dev", "0.9.51")).toBeNull();
  });
});
