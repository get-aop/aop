import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The real-runtime harness spends the person's own Claude login, so it never runs by accident:
 * every entry point calls `assertRealRuntimeEnabled` first, and the spawn gate refuses to start
 * `claude` without the flag, so a stack that is misconfigured cannot reach the real CLI.
 */
export const REAL_RUNTIME_FLAG = "AOP_REAL_RUNTIME";

export type Env = Record<string, string | undefined>;

export const assertRealRuntimeEnabled = (env: Env): void => {
  if (env[REAL_RUNTIME_FLAG] === "1") return;
  throw new Error(
    `Refusing to run: the real-runtime harness calls the real claude CLI on your login. Set ${REAL_RUNTIME_FLAG}=1 to allow it.`,
  );
};

export interface GateLimits {
  /** Runs of the real CLI the whole harness may start. */
  maxRuns: number;
  /** Total cost the runs may add up to, from the `total_cost_usd` of each result. */
  maxCostUsd: number;
  /** Wall-clock limit for one run; the gate kills it after this. */
  runTimeoutMs: number;
}

export const DEFAULT_LIMITS: GateLimits = { maxRuns: 40, maxCostUsd: 6, runTimeoutMs: 300_000 };

export interface GateConfig extends GateLimits {
  /** Where the ledger and the per-run stderr files go. */
  dir: string;
  /** The real CLI the gate runs. */
  claude: string;
}

const LIMIT_VARS = {
  maxRuns: "AOP_REAL_RUNTIME_MAX_RUNS",
  maxCostUsd: "AOP_REAL_RUNTIME_MAX_COST_USD",
  runTimeoutMs: "AOP_REAL_RUNTIME_RUN_TIMEOUT_MS",
} as const;

export const readGateConfig = (env: Env): GateConfig => {
  const dir = env.AOP_REAL_RUNTIME_DIR;
  if (!dir) throw new Error("AOP_REAL_RUNTIME_DIR is not set");
  return {
    dir,
    claude: env.AOP_REAL_RUNTIME_CLAUDE ?? join(homedir(), ".local", "bin", "claude"),
    ...readLimits(env),
  };
};

export const readLimits = (env: Env): GateLimits => ({
  maxRuns: numberFrom(env[LIMIT_VARS.maxRuns], DEFAULT_LIMITS.maxRuns),
  maxCostUsd: numberFrom(env[LIMIT_VARS.maxCostUsd], DEFAULT_LIMITS.maxCostUsd),
  runTimeoutMs: numberFrom(env[LIMIT_VARS.runTimeoutMs], DEFAULT_LIMITS.runTimeoutMs),
});

export const limitEnv = (limits: GateLimits): Record<string, string> => ({
  [LIMIT_VARS.maxRuns]: String(limits.maxRuns),
  [LIMIT_VARS.maxCostUsd]: String(limits.maxCostUsd),
  [LIMIT_VARS.runTimeoutMs]: String(limits.runTimeoutMs),
});

const numberFrom = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return raw !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
};
