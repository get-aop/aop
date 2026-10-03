import { describe, expect, test } from "bun:test";
import { CHANNELS } from "@aop/common";
import { type SpawnSyncFn, stopRunningService } from "./service.ts";

/** Answers each command by its exact text and records what ran; anything unlisted exits 1. */
const recordingSpawn = (exitCodes: Record<string, number>) => {
  const ran: string[] = [];
  const spawnSync: SpawnSyncFn = (command) => {
    const line = command.join(" ");
    ran.push(line);
    return { exitCode: exitCodes[line] ?? 1 };
  };
  return { spawnSync, ran };
};

describe("stopRunningService on Linux", () => {
  test("stops the channel's own unit when it is active", () => {
    const { spawnSync, ran } = recordingSpawn({
      "systemctl --user is-active aop-nightly-local-server.service": 0,
      "systemctl --user stop aop-nightly-local-server.service": 0,
    });

    const result = stopRunningService({ platform: "linux", spawnSync, channel: CHANNELS.nightly });

    expect(result).toEqual({ kind: "stopped", service: "aop-nightly-local-server.service" });
    expect(ran).toEqual([
      "systemctl --user is-active aop-nightly-local-server.service",
      "systemctl --user stop aop-nightly-local-server.service",
    ]);
  });

  test("AOP Nightly never stops a running stable unit", () => {
    const { spawnSync, ran } = recordingSpawn({
      "systemctl --user is-active aop-local-server.service": 0,
      "systemctl --user stop aop-local-server.service": 0,
    });

    const result = stopRunningService({ platform: "linux", spawnSync, channel: CHANNELS.nightly });

    expect(result).toEqual({ kind: "none" });
    expect(ran.some((line) => line.includes("aop-local-server.service"))).toBe(false);
  });

  test("reports a unit systemctl would not stop", () => {
    const { spawnSync } = recordingSpawn({
      "systemctl --user is-active aop-local-server.service": 0,
    });

    expect(stopRunningService({ platform: "linux", spawnSync, channel: CHANNELS.stable })).toEqual({
      kind: "failed",
      service: "aop-local-server.service",
    });
  });
});

describe("stopRunningService on macOS", () => {
  test("unloads the channel's loaded launch agent", () => {
    const { spawnSync, ran } = recordingSpawn({
      "launchctl list com.aop.local-server": 0,
      "launchctl unload /Users/me/Library/LaunchAgents/com.aop.local-server.plist": 0,
    });

    const result = stopRunningService({
      platform: "darwin",
      spawnSync,
      channel: CHANNELS.stable,
      home: "/Users/me",
    });

    expect(result).toEqual({ kind: "stopped", service: "com.aop.local-server" });
    expect(ran).toEqual([
      "launchctl list com.aop.local-server",
      "launchctl unload /Users/me/Library/LaunchAgents/com.aop.local-server.plist",
    ]);
  });

  test("leaves everything alone when the agent is not loaded", () => {
    const { spawnSync, ran } = recordingSpawn({});

    const result = stopRunningService({
      platform: "darwin",
      spawnSync,
      channel: CHANNELS.nightly,
      home: "/Users/me",
    });

    expect(result).toEqual({ kind: "none" });
    expect(ran).toEqual(["launchctl list com.aop.local-server.nightly"]);
  });
});

test("other platforms have no service to stop", () => {
  const { spawnSync, ran } = recordingSpawn({});

  expect(stopRunningService({ platform: "win32", spawnSync })).toEqual({ kind: "none" });
  expect(ran).toEqual([]);
});
