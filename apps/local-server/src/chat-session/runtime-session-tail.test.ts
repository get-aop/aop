import { describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRuntimeSessionLineInspector,
  startRuntimeSessionTail,
} from "./runtime-session-tail.ts";

describe("startRuntimeSessionTail", () => {
  test("discovers Codex and Claude ids from growing logs", async () => {
    for (const [event, expected] of [
      [{ type: "thread.started", thread_id: "codex-thread" }, "codex-thread"],
      [{ type: "system", session_id: "claude-session" }, "claude-session"],
    ] as const) {
      const dir = await mkdtemp(join(tmpdir(), "aop-session-tail-"));
      const path = join(dir, "run.jsonl");
      await writeFile(path, "");
      let stop: (() => Promise<void>) | undefined;
      const found = new Promise<string>((resolve) => {
        stop = startRuntimeSessionTail({
          runtime: "codex-cli",
          logFilePath: path,
          pollIntervalMs: 1,
          onSession: resolve,
        });
      });
      await appendFile(path, `${JSON.stringify(event)}\n`);
      expect(await found).toBe(expected);
      await stop?.();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("confirms a preallocated Grok id on valid activity but not an error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-grok-tail-"));
    const path = join(dir, "run.jsonl");
    await writeFile(path, `${JSON.stringify({ type: "error", message: "auth failed" })}\n`);
    let called = false;
    const stop = startRuntimeSessionTail({
      runtime: "grok-build",
      logFilePath: path,
      newSessionId: "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
      pollIntervalMs: 1,
      onSession: () => {
        called = true;
      },
    });
    await Bun.sleep(5);
    expect(called).toBe(false);
    await appendFile(path, `${JSON.stringify({ type: "thought", data: "working" })}\n`);
    await Bun.sleep(5);
    expect(called).toBe(true);
    await stop();
    await rm(dir, { recursive: true, force: true });
  });

  test.each([
    { type: "result", status: "failed", error: "request failed" },
    { type: "end", stopReason: "InternalError" },
  ])("does not confirm a preallocated Grok id from a failed event", async (event) => {
    const dir = await mkdtemp(join(tmpdir(), "aop-grok-failed-tail-"));
    const path = join(dir, "run.jsonl");
    await writeFile(path, `${JSON.stringify(event)}\n`);
    let called = false;
    const stop = startRuntimeSessionTail({
      runtime: "grok-build",
      logFilePath: path,
      newSessionId: "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
      pollIntervalMs: 1,
      onSession: () => {
        called = true;
      },
    });

    await Bun.sleep(5);
    await stop();
    expect(called).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("createRuntimeSessionLineInspector", () => {
  test("ignores irrelevant lines and reports a discovered id once", async () => {
    const reported: string[] = [];
    const inspect = createRuntimeSessionLineInspector({
      runtime: "codex-cli",
      onSession: async (id) => {
        reported.push(id);
      },
    });

    expect(await inspect("")).toBe(false);
    expect(await inspect("{not json}")).toBe(false);
    expect(await inspect(JSON.stringify({ type: "text", data: "hi" }))).toBe(false);
    expect(await inspect(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }))).toBe(
      true,
    );
    expect(await inspect(JSON.stringify({ type: "thread.started", thread_id: "thread-2" }))).toBe(
      true,
    );
    expect(reported).toEqual(["thread-1"]);
  });

  test("retries persistence after a rejected callback", async () => {
    let attempts = 0;
    const inspect = createRuntimeSessionLineInspector({
      runtime: "codex-cli",
      onSession: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("db write failed");
      },
    });

    await expect(
      inspect(JSON.stringify({ type: "thread.started", thread_id: "retry-me" })),
    ).rejects.toThrow("db write failed");
    expect(await inspect(JSON.stringify({ type: "thread.started", thread_id: "retry-me" }))).toBe(
      true,
    );
    expect(attempts).toBe(2);
  });

  test("dedupes concurrent reports of the same discovered id", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const inspect = createRuntimeSessionLineInspector({
      runtime: "codex-cli",
      onSession: async () => {
        calls += 1;
        await gate;
      },
    });

    const line = JSON.stringify({ type: "thread.started", thread_id: "shared" });
    const first = inspect(line);
    const second = inspect(line);
    release?.();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(calls).toBe(1);
  });
});
