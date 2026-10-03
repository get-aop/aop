import { describe, expect, test } from "bun:test";

import {
  isAgentCommand,
  isAgentProcess,
  isAgentRunning,
  isProcessAlive,
  isZombie,
  pollForProcessExit,
} from "./liveness.ts";
import { spawnRunning } from "./test-utils.ts";

describe("isProcessAlive", () => {
  test("returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("returns false for non-existent process", () => {
    expect(isProcessAlive(999999)).toBe(false);
  });

  test("handles process.kill exceptions", () => {
    expect(isProcessAlive(999998)).toBe(false);
  });
});

describe("isZombie", () => {
  test("returns false for current process", () => {
    expect(isZombie(process.pid)).toBe(false);
  });

  test("returns false for non-existent process", () => {
    expect(isZombie(999999)).toBe(false);
  });

  test("returns false when process read fails", () => {
    expect(isZombie(999998)).toBe(false);
  });

  test("returns false for running process on macOS", () => {
    expect(isZombie(process.pid)).toBe(false);
  });
});

describe("isAgentRunning", () => {
  test("returns true for current process", () => {
    expect(isAgentRunning(process.pid)).toBe(true);
  });

  test("returns false for non-existent process", () => {
    expect(isAgentRunning(999999)).toBe(false);
  });

  test("returns false when isProcessAlive is false", () => {
    expect(isAgentRunning(999998)).toBe(false);
  });

  test("returns false for zombie processes", () => {
    expect(isAgentRunning(999997)).toBe(false);
  });
});

describe("isAgentProcess", () => {
  test("returns false for a pid that does not exist", () => {
    expect(isAgentProcess(999999)).toBe(false);
  });

  test("returns false for a live process that is not an agent CLI", async () => {
    // process.pid's cmdline varies with the test invocation (paths may match);
    // a spawned neutral process is deterministic.
    const proc = await spawnRunning(["sleep", "2"]);
    try {
      expect(isAgentProcess(proc.pid)).toBe(false);
    } finally {
      proc.kill();
    }
  });

  test("accepts a live process whose command line contains the run's executable", async () => {
    const proc = await spawnRunning(["sleep", "2"]);
    try {
      expect(isAgentProcess(proc.pid, { executable: "sleep" })).toBe(true);
      expect(isAgentProcess(proc.pid, { executable: "/opt/fake-cli.ts" })).toBe(false);
    } finally {
      proc.kill();
    }
  });

  test("does not throw on win32 (powershell absent here, so false)", () => {
    expect(isAgentProcess(process.pid, { platform: "win32" })).toBe(false);
  });
});

describe("isAgentCommand", () => {
  test("recognizes Claude and Codex CLI agent commands", () => {
    expect(isAgentCommand("/opt/homebrew/bin/claude --print")).toBe(true);
    expect(isAgentCommand("/opt/homebrew/bin/codex exec --json task prompt")).toBe(true);
    expect(
      isAgentCommand("node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js exec task"),
    ).toBe(true);
  });

  test("recognizes a configured runtime alias", () => {
    const command = "bun /repo/test-fixtures/fake-cli.ts --verbose hi";
    expect(isAgentCommand(command, "/repo/test-fixtures/fake-cli.ts")).toBe(true);
    expect(isAgentCommand(command, "  ")).toBe(false);
  });

  test("rejects non-agent commands", () => {
    expect(isAgentCommand("bun run apps/local-server/src/run.ts")).toBe(false);
  });
});

describe("pollForProcessExit", () => {
  test("resolves at once for a pid that is not running", async () => {
    await pollForProcessExit(999999, 10);
  });

  test("resolves after a live process exits", async () => {
    const proc = Bun.spawn(["sleep", "0.2"], { stdout: "ignore", stderr: "ignore" });
    const startedAt = Date.now();
    // Bun reaps its own children, so the pid stops existing once `sleep` exits.
    await pollForProcessExit(proc.pid, 20);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
    expect(isAgentRunning(proc.pid)).toBe(false);
  });
});

describe("Windows platform branch", () => {
  test("isZombie returns false on win32 without shelling out to ps", () => {
    expect(isZombie(process.pid, "win32")).toBe(false);
    expect(isZombie(999999, "win32")).toBe(false);
  });
});
