import { describe, expect, test } from "bun:test";
import {
  findPidByEnvLinux,
  findPidByStepId,
  findPidsByEnvLinux,
  findPidsByTaskId,
} from "./process-utils.ts";

describe("findPidByStepId", () => {
  test("returns null when no processes match", () => {
    expect(findPidByStepId("nonexistent-step-id-xyz")).toBeNull();
  });

  test("returns null when lookup fails", () => {
    expect(findPidByStepId("")).toBeNull();
  });

  test("returns null for special characters", () => {
    expect(findPidByStepId("../../../etc/passwd")).toBeNull();
  });
});

describe("findPidsByTaskId", () => {
  test("returns empty array when no processes match", () => {
    expect(findPidsByTaskId("nonexistent-task-id-xyz")).toEqual([]);
  });

  test("returns array of length >= 0", () => {
    const result = findPidsByTaskId("test-task");
    expect(Array.isArray(result)).toBe(true);
  });

  test("handles empty task ID", () => {
    expect(findPidsByTaskId("")).toEqual([]);
  });
});

describe("Windows platform branch", () => {
  test("findPidByStepId returns null on win32 (env-by-PID unsupported natively)", () => {
    expect(findPidByStepId("step-x", "win32")).toBeNull();
  });

  test("findPidsByTaskId returns empty on win32", () => {
    expect(findPidsByTaskId("task-x", "win32")).toEqual([]);
  });
});

const isLinux = process.platform === "linux";

// Linux /proc tests — mock.module("node:fs") doesn't work in Bun for builtins,
// so these only run on Linux where /proc is available natively.
describe.skipIf(!isLinux)("findPidByEnvLinux (Linux only)", () => {
  test("returns null when no matching process found", () => {
    expect(findPidByEnvLinux("AOP_NONEXISTENT_VAR", "no-match")).toBeNull();
  });

  test("handles non-existent PIDs gracefully", () => {
    expect(findPidByEnvLinux("AOP_STEP_ID", "step-nonexistent")).toBeNull();
  });
});

describe.skipIf(!isLinux)("findPidsByEnvLinux (Linux only)", () => {
  test("returns empty array when no matching processes found", () => {
    expect(findPidsByEnvLinux("AOP_NONEXISTENT_VAR", "no-match")).toEqual([]);
  });

  test("handles non-existent PIDs gracefully", () => {
    expect(findPidsByEnvLinux("AOP_TASK_ID", "task-nonexistent")).toEqual([]);
  });
});
