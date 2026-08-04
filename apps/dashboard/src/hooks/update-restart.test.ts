import { describe, expect, mock, test } from "bun:test";
import { hasReachedTargetVersion, waitForUpdateRestart } from "./update-restart";

describe("update-restart", () => {
  test("reloads once the target version is reported", async () => {
    const reload = mock(() => {});
    const fetchStatus = mock(async () => ({
      currentVersion: "0.2.2+commit",
      latestVersion: "0.2.2",
      updateAvailable: false,
      canAutoUpdate: true,
    }));

    const result = await waitForUpdateRestart("0.2.2", {
      fetchStatus,
      reload,
      initialDelayMs: 0,
      pollIntervalMs: 1,
      timeoutMs: 100,
      sleep: async () => {},
    });

    expect(result).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("matches normalized semver cores", () => {
    expect(hasReachedTargetVersion("0.2.2+abc", "0.2.2")).toBe(true);
    expect(hasReachedTargetVersion("0.1.0+abc", "0.2.2")).toBe(false);
  });
});
