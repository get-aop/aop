import { describe, expect, test } from "bun:test";
import { hostDriftTag, updateLabel } from "./update-label";

describe("updateLabel", () => {
  test("names each stage of an update, and nothing when there is none", () => {
    expect(updateLabel({ status: "idle" })).toBeNull();
    expect(updateLabel({ status: "available", version: "0.10.0", releaseUrl: null })).toBe(
      "Update available (0.10.0)",
    );
    expect(updateLabel({ status: "downloading", version: "0.10.0", percent: 3 })).toBe(
      "Downloading update (0.10.0)",
    );
    expect(updateLabel({ status: "ready", version: "0.10.0" })).toBe("Restart to update (0.10.0)");
  });
});

describe("hostDriftTag", () => {
  test("says which way the host differs from the app", () => {
    expect(hostDriftTag("0.10.0+abc1234", "0.9.51")).toBe("host 0.10.0 is newer");
    expect(hostDriftTag("0.9.0", "0.9.51")).toBe("host 0.9.0 is older");
    expect(hostDriftTag("0.9.51", "0.9.51")).toBeNull();
    expect(hostDriftTag("dev", "0.9.51")).toBeNull();
  });
});
