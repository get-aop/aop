import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider, RunOptions, RunResult } from "@aop/llm-provider";
import { readRunResultFromLog, runAndReap } from "./reaper.ts";

let logsDir: string;

beforeEach(() => {
  logsDir = mkdtempSync(join(tmpdir(), "aop-reaper-"));
});

afterEach(() => {
  rmSync(logsDir, { recursive: true, force: true });
});

type RunMode = "on-exit" | "never" | "immediately";

/** Spawns a real process and reports its pid, then resolves according to `mode`. */
const spawningProvider = (cmd: string[], mode: RunMode): LLMProvider => ({
  name: "test",
  run: async (options: RunOptions): Promise<RunResult> => {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await options.onSpawn?.(proc.pid);
    if (mode === "never") return new Promise<RunResult>(() => {});
    if (mode === "immediately") return { exitCode: 0, sessionId: "from-provider" };
    await proc.exited;
    return { exitCode: proc.exitCode ?? 1, sessionId: "from-provider" };
  },
});

const successLog = (name: string, sessionId: string): string => {
  const logFile = join(logsDir, name);
  writeFileSync(
    logFile,
    [
      JSON.stringify({ type: "system", session_id: sessionId }),
      JSON.stringify({ type: "result", subtype: "success" }),
      "",
    ].join("\n"),
  );
  return logFile;
};

describe("runAndReap", () => {
  test("returns the provider result when no process was spawned", async () => {
    const provider: LLMProvider = {
      name: "test",
      run: async () => ({ exitCode: 3 }),
    };

    const result = await runAndReap(provider, { prompt: "p", logFilePath: "/missing.jsonl" });

    expect(result).toEqual({ exitCode: 3 });
  });

  test("reads the outcome from the log when the process exits but run() never resolves", async () => {
    const logFile = successLog("never.jsonl", "sess-from-log");
    const spawned: number[] = [];

    const result = await runAndReap(
      spawningProvider(["sleep", "0.1"], "never"),
      { prompt: "p", logFilePath: logFile, onSpawn: (pid) => void spawned.push(pid) },
      { pollIntervalMs: 20, graceMs: 50 },
    );

    expect(spawned).toHaveLength(1);
    expect(result).toEqual({ exitCode: 0, sessionId: "sess-from-log" });
  });

  test("waits for the pid to exit when run() resolves while the process is still alive", async () => {
    const startedAt = Date.now();

    const result = await runAndReap(
      spawningProvider(["sleep", "0.3"], "immediately"),
      { prompt: "p", logFilePath: join(logsDir, "alive.jsonl") },
      { pollIntervalMs: 20, graceMs: 200 },
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    expect(result).toEqual({ exitCode: 0, sessionId: "from-provider" });
  });

  test("prefers the provider's own result when it arrives within the grace period", async () => {
    const logFile = join(logsDir, "missing-on-purpose.jsonl");

    const result = await runAndReap(
      spawningProvider(["sleep", "0.05"], "on-exit"),
      { prompt: "p", logFilePath: logFile },
      { pollIntervalMs: 10, graceMs: 1000 },
    );

    expect(result).toEqual({ exitCode: 0, sessionId: "from-provider" });
  });

  test("rejects when the provider fails before spawning", async () => {
    const provider: LLMProvider = {
      name: "test",
      run: async () => {
        throw new Error("spawn failed");
      },
    };

    await expect(runAndReap(provider, { prompt: "p" })).rejects.toThrow("spawn failed");
  });
});

describe("readRunResultFromLog", () => {
  test("returns exitCode 1 when log file does not exist", () => {
    expect(readRunResultFromLog("/nonexistent/path.jsonl").exitCode).toBe(1);
  });

  test("returns exitCode 0 when last result is success", () => {
    const logFile = join(logsDir, "success.jsonl");
    writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success" }));
    expect(readRunResultFromLog(logFile).exitCode).toBe(0);
  });

  test("returns the session id from the log for recovery metadata", () => {
    const logFile = successLog("session.jsonl", "session-1");
    expect(readRunResultFromLog(logFile)).toEqual({ exitCode: 0, sessionId: "session-1" });
  });

  test("returns exitCode 1 when last result is failure", () => {
    const logFile = join(logsDir, "failure.jsonl");
    writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "error" }));
    expect(readRunResultFromLog(logFile).exitCode).toBe(1);
  });

  test("returns exitCode 0 when result entry is multi-line JSON", () => {
    const logFile = join(logsDir, "multiline-result.jsonl");
    writeFileSync(
      logFile,
      '{\n  "type": "result",\n  "subtype": "success",\n  "result": "done"\n}\n',
    );
    expect(readRunResultFromLog(logFile).exitCode).toBe(0);
  });

  test("returns exitCode 1 when trailing JSON line is partial", () => {
    const logFile = join(logsDir, "partial-tail.jsonl");
    writeFileSync(
      logFile,
      [
        JSON.stringify({ type: "assistant", message: "done" }),
        '{"type":"result","subtype":"success"',
      ].join("\n"),
    );
    expect(readRunResultFromLog(logFile).exitCode).toBe(1);
  });
});
