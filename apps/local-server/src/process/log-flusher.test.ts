import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogFlusher, type LogFlusher, type LogFlusherConfig } from "./log-flusher.ts";

const line = (message: string): string => JSON.stringify({ type: "assistant", message });

describe("LogFlusher", () => {
  let flusher: LogFlusher | undefined;
  let logsDir: string;
  let saved: Map<string, string[]>;

  const memorySink: LogFlusherConfig["saveLines"] = async (runId, lines) => {
    saved.set(runId, [...(saved.get(runId) ?? []), ...lines]);
  };

  const writeLog = (runId: string, lines: string[]): string => {
    const logFile = join(logsDir, `${runId}.jsonl`);
    // Providers write newline-terminated JSONL records.
    writeFileSync(logFile, `${lines.join("\n")}\n`);
    return logFile;
  };

  const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    saved = new Map();
    logsDir = mkdtempSync(join(tmpdir(), "aop-test-flusher-"));
  });

  afterEach(() => {
    flusher?.stop();
    flusher = undefined;
    rmSync(logsDir, { recursive: true, force: true });
  });

  test("track + finalFlush saves every line of a chat run's log", async () => {
    flusher = createLogFlusher({ saveLines: memorySink });
    const lines = [line("line 1"), line("line 2"), JSON.stringify({ type: "result" })];
    flusher.track("crun_1", writeLog("crun_1", lines));

    await flusher.finalFlush("crun_1");

    expect(saved.get("crun_1")).toEqual(lines);
  });

  test("finalFlush consumes a trailing partial line", async () => {
    flusher = createLogFlusher({ saveLines: memorySink });
    const logFile = join(logsDir, "partial.jsonl");
    writeFileSync(logFile, `${line("complete")}\n{"type":"result"`);
    flusher.track("crun_partial", logFile);

    await flusher.finalFlush("crun_partial");

    expect(saved.get("crun_partial")).toEqual([line("complete"), '{"type":"result"']);
  });

  test("calls the projection hook after lines are saved", async () => {
    const afterLinesSaved = mock(() => Promise.resolve());
    flusher = createLogFlusher({ saveLines: memorySink, afterLinesSaved });
    flusher.track("crun_1", writeLog("crun_1", [line("hello")]));

    await flusher.finalFlush("crun_1");

    expect(afterLinesSaved).toHaveBeenCalledWith("crun_1");
  });

  test("does not duplicate saved lines when the projection hook fails", async () => {
    const afterLinesSaved = mock(() => {
      throw new Error("projection failed");
    });
    flusher = createLogFlusher({ saveLines: memorySink, flushIntervalMs: 50, afterLinesSaved });
    flusher.track("crun_proj", writeLog("crun_proj", [line("line")]));

    flusher.start();
    await tick(130);

    expect(saved.get("crun_proj")).toEqual([line("line")]);
    expect(afterLinesSaved).toHaveBeenCalled();
  });

  test("retries the same lines on the next tick when saving fails", async () => {
    let failures = 1;
    const saveLines: LogFlusherConfig["saveLines"] = async (runId, lines) => {
      if (failures-- > 0) throw new Error("database busy");
      await memorySink(runId, lines);
    };
    flusher = createLogFlusher({ saveLines, flushIntervalMs: 40 });
    flusher.track("crun_retry", writeLog("crun_retry", [line("line 1"), line("line 2")]));

    flusher.start();
    await tick(130);

    expect(saved.get("crun_retry")).toEqual([line("line 1"), line("line 2")]);
  });

  test("finalFlush on an untracked run is a no-op", async () => {
    flusher = createLogFlusher({ saveLines: memorySink });
    await flusher.finalFlush("crun_unknown");
    expect(saved.size).toBe(0);
  });

  test("periodic ticks flush only the lines appended since the last tick", async () => {
    flusher = createLogFlusher({ saveLines: memorySink, flushIntervalMs: 50 });
    const logFile = writeLog("crun_periodic", [line("line 1")]);
    flusher.track("crun_periodic", logFile);
    flusher.start();

    await tick(120);
    expect(saved.get("crun_periodic")).toEqual([line("line 1")]);

    // Rewrite keeps the flushed prefix identical, like an appending CLI.
    writeLog("crun_periodic", [line("line 1"), line("line 2"), line("line 3")]);
    await tick(120);

    expect(saved.get("crun_periodic")).toEqual([line("line 1"), line("line 2"), line("line 3")]);
  });

  test("stop clears timers and tracking", async () => {
    flusher = createLogFlusher({ saveLines: memorySink, flushIntervalMs: 50 });
    flusher.track("crun_stop", writeLog("crun_stop", [line("line 1")]));
    flusher.start();
    flusher.stop();

    await flusher.finalFlush("crun_stop");
    await tick(80);

    expect(saved.get("crun_stop")).toBeUndefined();
  });

  test("saves resumed output when the CLI rewrites the log file shorter", async () => {
    flusher = createLogFlusher({ saveLines: memorySink, flushIntervalMs: 50 });
    const firstSegment = [line("first 1"), line("first 2"), line("first 3"), line("first 4")];
    flusher.track("crun_rotated", writeLog("crun_rotated", firstSegment));
    flusher.start();
    await tick(120);
    expect(saved.get("crun_rotated")).toEqual(firstSegment);

    const resumedSegment = [line("resumed 1"), line("resumed 2")];
    writeLog("crun_rotated", resumedSegment);
    await flusher.finalFlush("crun_rotated");

    expect(saved.get("crun_rotated")).toEqual([...firstSegment, ...resumedSegment]);
  });

  test("handles a missing log file gracefully", async () => {
    flusher = createLogFlusher({ saveLines: memorySink });
    flusher.track("crun_missing", join(logsDir, "nonexistent.jsonl"));

    await flusher.finalFlush("crun_missing");

    expect(saved.get("crun_missing")).toBeUndefined();
  });

  test("start is idempotent", () => {
    flusher = createLogFlusher({ saveLines: memorySink, flushIntervalMs: 1000 });
    flusher.start();
    flusher.start();
    flusher.stop();
  });
});
