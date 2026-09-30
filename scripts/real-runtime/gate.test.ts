import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createFakeCliSandbox, FAKE_CLI_PATH } from "@aop/llm-provider/test-fixtures";
import { FLAG_MISSING_EXIT_CODE, REFUSED_EXIT_CODE, readResultFacts, runGate } from "./gate.ts";
import { readLedger, summarizeLedger } from "./ledger.ts";

// The gate runs the fake CLI in place of the real one, so nothing here can reach a model.
describe("the claude gate", () => {
  let sandbox: ReturnType<typeof createFakeCliSandbox>;
  let chunks: Uint8Array[];

  const env = (extra: Record<string, string> = {}) => ({
    ...process.env,
    AOP_REAL_RUNTIME: "1",
    AOP_REAL_RUNTIME_DIR: sandbox.dir,
    AOP_REAL_RUNTIME_CLAUDE: FAKE_CLI_PATH,
    FAKE_CLI_HOME: sandbox.home,
    ...extra,
  });
  const gate = (prompt: string, extra?: Record<string, string>) =>
    runGate(["--output-format", "stream-json", "--verbose", prompt], env(extra), sandbox.dir, (c) =>
      chunks.push(c),
    );
  const stdout = () => Buffer.concat(chunks).toString("utf8");

  beforeEach(() => {
    sandbox = createFakeCliSandbox();
    chunks = [];
  });
  afterEach(() => sandbox.cleanup());

  test("refuses without the flag and leaves no ledger", async () => {
    const code = await runGate(["hello"], env({ AOP_REAL_RUNTIME: "" }), sandbox.dir, (c) =>
      chunks.push(c),
    );

    expect(code).toBe(FLAG_MISSING_EXIT_CODE);
    expect(stdout()).toBe("");
    expect(readLedger(sandbox.dir)).toEqual([]);
  });

  test("passes the CLI's stdout through and ledgers the run with its cost and turns", async () => {
    const code = await gate("hello [fake: usage=1000,200,3000,50000]");

    expect(code).toBe(0);
    expect(stdout()).toContain('"type":"result"');
    const entries = readLedger(sandbox.dir);
    expect(entries.map((entry) => entry.event)).toEqual(["start", "end"]);
    const summary = summarizeLedger(entries);
    expect(summary.runs).toBe(1);
    expect(summary.costUsd).toBeCloseTo(0.16125, 5);
    expect(summary.cliTurns).toBeGreaterThan(0);
    const end = entries[1];
    expect(end?.event === "end" && end.sessionId).toBeTruthy();
  });

  test("refuses a run past the run cap, and past the cost cap", async () => {
    expect(await gate("one", { AOP_REAL_RUNTIME_MAX_RUNS: "1" })).toBe(0);

    expect(await gate("two", { AOP_REAL_RUNTIME_MAX_RUNS: "1" })).toBe(REFUSED_EXIT_CODE);
    expect(summarizeLedger(readLedger(sandbox.dir)).runs).toBe(1);

    const code = await gate("three", { AOP_REAL_RUNTIME_MAX_COST_USD: "0.0000001" });
    expect(code).toBe(REFUSED_EXIT_CODE);
  });

  test("kills a run that outlives its wall-clock limit", async () => {
    await gate("slow [fake: steps=3 delay=2000]", { AOP_REAL_RUNTIME_RUN_TIMEOUT_MS: "400" });

    const summary = summarizeLedger(readLedger(sandbox.dir));
    expect(summary.timedOut).toBe(1);
  });

  test("keeps the CLI's stderr for the run beside the ledger", async () => {
    await gate("hello");

    const stderrFiles = new Bun.Glob("run-*.stderr").scanSync({ cwd: sandbox.dir });
    expect([...stderrFiles].length).toBe(1);
    expect(existsSync(`${sandbox.dir}/ledger.jsonl`)).toBe(true);
  });
});

describe("readResultFacts", () => {
  test("reads cost, turns and session from a result line", () => {
    const line = JSON.stringify({
      type: "result",
      total_cost_usd: 0.05,
      num_turns: 3,
      session_id: "s1",
    });

    expect(readResultFacts(line)).toEqual({ costUsd: 0.05, numTurns: 3, sessionId: "s1" });
  });

  test("ignores other events and torn lines", () => {
    expect(readResultFacts('{"type":"assistant"}')).toBeNull();
    expect(readResultFacts('{"type":"result","total_cost')).toBeNull();
    expect(readResultFacts('{"type":"result"}')).toEqual({
      costUsd: null,
      numTurns: null,
      sessionId: null,
    });
  });
});
