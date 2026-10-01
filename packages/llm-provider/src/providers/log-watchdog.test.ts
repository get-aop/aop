import { describe, expect, mock, test } from "bun:test";
import {
  createFileActivityTracker,
  createLogOutputTimeoutWatchdog,
  createWatchdog,
} from "./log-watchdog";

describe("createWatchdog", () => {
  test("does not trigger callback when activity is within timeout", async () => {
    let onTimeoutCalled = false;
    const lastActivity = Date.now();

    const watchdog = createWatchdog(
      1000,
      () => lastActivity,
      () => {
        onTimeoutCalled = true;
      },
      50,
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    watchdog.stop();
    expect(onTimeoutCalled).toBe(false);
  });

  test("triggers callback when inactivity exceeds timeout", async () => {
    let onTimeoutCalled = false;
    const startTime = Date.now();

    createWatchdog(
      1000,
      () => startTime - 2000,
      () => {
        onTimeoutCalled = true;
      },
      50,
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onTimeoutCalled).toBe(true);
  });

  test("stop() clears the interval and prevents callback", async () => {
    let onTimeoutCalled = false;
    const startTime = Date.now();

    const watchdog = createWatchdog(
      1000,
      () => startTime - 2000,
      () => {
        onTimeoutCalled = true;
      },
      50,
    );

    watchdog.stop();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onTimeoutCalled).toBe(false);
  });
});

describe("createLogOutputTimeoutWatchdog", () => {
  test("fires startup timeout when log never has non-empty output before deadline", async () => {
    const state = { timedOut: "none" as "startup" | "inactivity" | "none" };
    let now = 1_000;
    const hasNonEmptyOutput = mock<(path: string) => boolean>().mockReturnValue(false);

    const watchdog = createLogOutputTimeoutWatchdog({
      logFilePath: "/tmp/startup-empty.jsonl",
      startupTimeoutMs: 100,
      inactivityTimeoutMs: 10_000,
      onTimeout: (kind) => {
        state.timedOut = kind;
      },
      checkIntervalMs: 20,
      getNow: () => now,
      hasNonEmptyOutput,
    });

    now = 1_150;
    await new Promise((resolve) => setTimeout(resolve, 60));
    watchdog.stop();

    expect(state.timedOut).toBe("startup");
  });

  test("disables startup watchdog permanently once non-empty output appears", async () => {
    const state = { timedOut: "none" as "startup" | "inactivity" | "none" };
    let now = 1_000;
    let hasOutput = false;
    let lastActivity = 1_000;

    const watchdog = createLogOutputTimeoutWatchdog({
      logFilePath: "/tmp/startup-then-output.jsonl",
      startupTimeoutMs: 100,
      inactivityTimeoutMs: 10_000,
      onTimeout: (kind) => {
        state.timedOut = kind;
      },
      checkIntervalMs: 20,
      getNow: () => now,
      hasNonEmptyOutput: () => hasOutput,
      getLastActivity: () => lastActivity,
    });

    hasOutput = true;
    lastActivity = 1_050;
    now = 1_200;
    await new Promise((resolve) => setTimeout(resolve, 60));
    watchdog.stop();

    expect(state.timedOut).toBe("none");
  });

  test("uses inactivity path after first output instead of startup timeout", async () => {
    const state = { timedOut: "none" as "startup" | "inactivity" | "none" };
    let now = 1_000;
    let hasOutput = false;
    let lastActivity = 1_000;

    const watchdog = createLogOutputTimeoutWatchdog({
      logFilePath: "/tmp/startup-then-stall.jsonl",
      startupTimeoutMs: 10_000,
      inactivityTimeoutMs: 100,
      onTimeout: (kind) => {
        state.timedOut = kind;
      },
      checkIntervalMs: 20,
      getNow: () => now,
      hasNonEmptyOutput: () => hasOutput,
      getLastActivity: () => lastActivity,
    });

    hasOutput = true;
    lastActivity = 1_000;
    now = 1_150;
    await new Promise((resolve) => setTimeout(resolve, 60));
    watchdog.stop();

    expect(state.timedOut).toBe("inactivity");
  });
});

describe("createFileActivityTracker", () => {
  test("preserves the last observed activity when the log file disappears", () => {
    const readMtime = mock<(path: string) => number>();
    readMtime
      .mockReturnValueOnce(Number.NaN)
      .mockReturnValueOnce(250)
      .mockReturnValueOnce(Number.NaN);

    const getLastActivity = createFileActivityTracker("/tmp/provider-log.jsonl", {
      getNow: () => 100,
      readMtime,
    });

    expect(getLastActivity()).toBe(100);
    expect(getLastActivity()).toBe(250);
    expect(getLastActivity()).toBe(250);
  });
});
