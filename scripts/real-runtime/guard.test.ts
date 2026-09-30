import { describe, expect, test } from "bun:test";
import {
  assertRealRuntimeEnabled,
  DEFAULT_LIMITS,
  limitEnv,
  readGateConfig,
  readLimits,
} from "./guard.ts";

describe("the real-runtime guard", () => {
  test("refuses without AOP_REAL_RUNTIME=1, whatever else is set", () => {
    expect(() => assertRealRuntimeEnabled({})).toThrow("Set AOP_REAL_RUNTIME=1");
    expect(() => assertRealRuntimeEnabled({ AOP_REAL_RUNTIME: "true" })).toThrow("Refusing");
    expect(() => assertRealRuntimeEnabled({ AOP_REAL_RUNTIME: "0" })).toThrow("Refusing");
    expect(() => assertRealRuntimeEnabled({ AOP_REAL_RUNTIME: "1" })).not.toThrow();
  });

  test("limits come from the environment and fall back to the defaults for nonsense", () => {
    expect(readLimits({})).toEqual(DEFAULT_LIMITS);
    expect(
      readLimits({
        AOP_REAL_RUNTIME_MAX_RUNS: "5",
        AOP_REAL_RUNTIME_MAX_COST_USD: "0.5",
        AOP_REAL_RUNTIME_RUN_TIMEOUT_MS: "-3",
      }),
    ).toEqual({ maxRuns: 5, maxCostUsd: 0.5, runTimeoutMs: DEFAULT_LIMITS.runTimeoutMs });
  });

  test("limits survive a round trip through the stack's environment", () => {
    const limits = { maxRuns: 7, maxCostUsd: 2.5, runTimeoutMs: 90_000 };

    expect(readLimits(limitEnv(limits))).toEqual(limits);
  });

  test("the gate needs a directory, and runs ~/.local/bin/claude unless told otherwise", () => {
    expect(() => readGateConfig({})).toThrow("AOP_REAL_RUNTIME_DIR");
    expect(readGateConfig({ AOP_REAL_RUNTIME_DIR: "/d" }).claude).toMatch(/\.local\/bin\/claude$/);
    expect(
      readGateConfig({ AOP_REAL_RUNTIME_DIR: "/d", AOP_REAL_RUNTIME_CLAUDE: "/x" }).claude,
    ).toBe("/x");
  });
});
