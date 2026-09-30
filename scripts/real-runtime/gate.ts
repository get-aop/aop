import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { assertRealRuntimeEnabled, type Env, type GateConfig, readGateConfig } from "./guard.ts";
import {
  appendLedger,
  type LedgerEntry,
  nextRunNumber,
  readLedger,
  summarizeLedger,
} from "./ledger.ts";

/**
 * The only way the harness's stack reaches the real `claude`: it is registered as the runtime
 * command, so every run AOP starts passes through here. It refuses past the run and cost caps,
 * kills a run that outlives its wall-clock limit, records each run in the ledger, and otherwise
 * hands the CLI's stdout through unchanged, so AOP sees exactly what the real CLI wrote.
 */
export const REFUSED_EXIT_CODE = 98;
export const FLAG_MISSING_EXIT_CODE = 97;

export const runGate = async (
  args: string[],
  env: Env,
  cwd: string,
  writeStdout: (chunk: Uint8Array) => void,
): Promise<number> => {
  try {
    assertRealRuntimeEnabled(env);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return FLAG_MISSING_EXIT_CODE;
  }
  const config = readGateConfig(env);
  const refusal = capRefusal(config);
  if (refusal) {
    process.stderr.write(`real-runtime gate: ${refusal}\n`);
    return REFUSED_EXIT_CODE;
  }
  return spawnRun(config, args, env, cwd, writeStdout);
};

/** Why another run may not start, or null when it may. */
export const capRefusal = (config: GateConfig): string | null => {
  const summary = summarizeLedger(readLedger(config.dir));
  if (summary.runs >= config.maxRuns) {
    return `run cap reached (${summary.runs} of ${config.maxRuns} runs started)`;
  }
  if (summary.costUsd >= config.maxCostUsd) {
    return `cost cap reached ($${summary.costUsd.toFixed(2)} of $${config.maxCostUsd.toFixed(2)})`;
  }
  return null;
};

export interface ResultFacts {
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
}

/** What the gate records from one stream-json line: only a `result` event has anything to read. */
export const readResultFacts = (line: string): ResultFacts | null => {
  if (!line.includes('"type":"result"')) return null;
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event.type !== "result") return null;
    return {
      costUsd: typeof event.total_cost_usd === "number" ? event.total_cost_usd : null,
      numTurns: typeof event.num_turns === "number" ? event.num_turns : null,
      sessionId: typeof event.session_id === "string" ? event.session_id : null,
    };
  } catch {
    return null;
  }
};

const spawnRun = async (
  config: GateConfig,
  args: string[],
  env: Env,
  cwd: string,
  writeStdout: (chunk: Uint8Array) => void,
): Promise<number> => {
  const n = nextRunNumber(readLedger(config.dir));
  appendLedger(config.dir, {
    event: "start",
    n,
    pid: process.pid,
    at: new Date().toISOString(),
    cwd,
    argv: args,
  });
  const stderrFd = openSync(join(config.dir, `run-${n}-${process.pid}.stderr`), "a");
  const startedAt = Date.now();
  const child = Bun.spawn({
    cmd: [config.claude, ...args],
    cwd,
    env: env as Record<string, string>,
    stdin: "ignore",
    stdout: "pipe",
    stderr: stderrFd,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, config.runTimeoutMs);
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill());

  const facts = await pipeThrough(child.stdout, writeStdout);
  const exitCode = await child.exited;
  clearTimeout(timer);
  closeSync(stderrFd);
  const end: LedgerEntry = {
    event: "end",
    n,
    exitCode,
    durationMs: Date.now() - startedAt,
    timedOut,
    costUsd: facts?.costUsd ?? null,
    numTurns: facts?.numTurns ?? null,
    sessionId: facts?.sessionId ?? null,
  };
  appendLedger(config.dir, end);
  return exitCode;
};

const pipeThrough = async (
  stream: ReadableStream<Uint8Array>,
  writeStdout: (chunk: Uint8Array) => void,
): Promise<ResultFacts | null> => {
  const decoder = new TextDecoder();
  let pending = "";
  let facts: ResultFacts | null = null;
  for await (const chunk of stream) {
    writeStdout(chunk);
    const lines = (pending + decoder.decode(chunk, { stream: true })).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) facts = readResultFacts(line) ?? facts;
  }
  return readResultFacts(pending) ?? facts;
};
