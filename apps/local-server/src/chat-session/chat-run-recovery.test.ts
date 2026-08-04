import { describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatRun } from "../db/schema.ts";
import { detectChatRunTerminalState, waitForChatRunTerminal } from "./chat-run-recovery.ts";

describe("detectChatRunTerminalState", () => {
  test.each([
    [
      "grok-build",
      [
        { type: "text", data: "Done" },
        { type: "end", stopReason: "EndTurn" },
      ],
    ],
    ["codex-cli", [{ type: "turn.completed", "last-assistant-message": "Done" }]],
    ["claude-code", [{ type: "result", subtype: "success", result: "Done" }]],
    ["opencode", [{ type: "step_finish", part: { reason: "stop" } }]],
    ["pi", [{ type: "agent_end", messages: [] }]],
  ])("detects %s terminal success", (runtime, events) => {
    expect(detectChatRunTerminalState(runtime, jsonl(events))).toBe("succeeded");
  });

  test("gives explicit failure precedence over success", () => {
    expect(
      detectChatRunTerminalState(
        "codex-cli",
        jsonl([{ type: "turn.completed" }, { type: "turn.failed", error: "boom" }]),
      ),
    ).toBe("failed");
  });

  test("does not treat a failed Pi tool call as a failed agent run", () => {
    expect(
      detectChatRunTerminalState(
        "pi",
        jsonl([
          { type: "tool_execution_end", isError: true, error: "command failed" },
          { type: "agent_end", messages: [] },
        ]),
      ),
    ).toBe("succeeded");
  });

  test("keeps partial or non-terminal logs running", () => {
    expect(detectChatRunTerminalState("grok-build", '{"type":"end"')).toBe("running");
    expect(detectChatRunTerminalState("grok-build", jsonl([{ type: "text", data: "wait" }]))).toBe(
      "running",
    );
  });

  test("does not recover an unsafe runtime session id from a log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-"));
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(
      logFilePath,
      jsonl([
        { type: "text", data: "Done" },
        { type: "end", stopReason: "EndTurn", sessionId: "--unsafe-resume" },
      ]),
    );

    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath),
      pollIntervalMs: 1,
    });

    expect(recovered.status).toBe("completed");
    expect(recovered.runtimeSessionId).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  test("fails recovered success terminal without assistant text as empty_output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-empty-"));
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, jsonl([{ type: "end", stopReason: "EndTurn" }]));

    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath),
      pollIntervalMs: 1,
    });

    expect(recovered.status).toBe("failed");
    expect(recovered.failureKind).toBe("empty_output");
    expect(recovered.text).not.toContain("Finished via");
    await rm(dir, { recursive: true, force: true });
  });

  test("uses startup timeout when the log never gains non-empty output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-startup-"));
    const logFilePath = join(dir, "missing.jsonl");
    let now = Date.parse("2026-07-12T00:00:00.000Z");

    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath, {
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      }),
      pollIntervalMs: 5,
      startupTimeoutMs: 20,
      getNow: () => {
        now += 15;
        return now;
      },
    });

    expect(recovered.status).toBe("failed");
    expect(recovered.failureKind).toBe("startup_timeout");
    await rm(dir, { recursive: true, force: true });
  });

  test("recovers a durable active session id when the log has no id event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-durable-id-"));
    const logFilePath = join(dir, "missing.jsonl");
    let now = Date.parse("2026-07-12T00:00:00.000Z");
    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath, {
        runtime_session_id: "durable-session-id",
        runtime_session_state: "confirmed",
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      }),
      pollIntervalMs: 1,
      startupTimeoutMs: 10,
      getNow: () => (now += 20),
    });
    expect(recovered.runtimeSessionId).toBe("durable-session-id");
    await rm(dir, { recursive: true, force: true });
  });

  test("marks an allocated Grok session confirmed after valid recovered activity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-confirmed-"));
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(
      logFilePath,
      jsonl([
        { type: "thought", data: "working" },
        { type: "text", data: "Done" },
        { type: "end", stopReason: "EndTurn" },
      ]),
    );

    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath, {
        runtime_session_id: "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
        runtime_session_state: "allocated",
      }),
      pollIntervalMs: 1,
    });

    expect(recovered.runtimeSessionId).toBe("0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f");
    expect(recovered.runtimeSessionState).toBe("confirmed");
    await rm(dir, { recursive: true, force: true });
  });

  test("forwards native Grok progress while recovering a detached run", async () => {
    const home = await mkdtemp(join(tmpdir(), "aop-chat-recovery-grok-home-"));
    const cwd = "/tmp/project";
    const runtimeSessionId = crypto.randomUUID();
    const sessionDir = join(home, ".grok", "sessions", encodeURIComponent(cwd), runtimeSessionId);
    const logFilePath = join(home, "run.jsonl");
    await mkdir(sessionDir, { recursive: true });
    await Promise.all([
      writeFile(join(sessionDir, "events.jsonl"), ""),
      writeFile(join(sessionDir, "updates.jsonl"), ""),
      writeFile(logFilePath, ""),
    ]);
    const snapshots: Array<{ commands: number; detail?: string }> = [];
    const recovery = waitForChatRunTerminal({
      run: runningRun(logFilePath, {
        workspace_path: cwd,
        runtime_session_id: runtimeSessionId,
        runtime_session_state: "confirmed",
      }),
      grokHome: home,
      pollIntervalMs: 10,
      startupTimeoutMs: 350,
      onProgress: (progress) => {
        const commands = progress.commandGroups.flatMap((group) => group.commands);
        snapshots.push({ commands: commands.length, detail: commands.at(-1)?.detail });
      },
    });

    await appendFile(
      join(sessionDir, "updates.jsonl"),
      `${JSON.stringify({
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "recovered-call",
            status: "in_progress",
            content: [{ content: { text: "Polling attempt 12" } }],
          },
        },
      })}\n`,
    );
    await waitFor(
      () => snapshots.some((snapshot) => snapshot.detail === "Polling attempt 12"),
      2_000,
    );
    await Bun.sleep(150);
    await appendFile(
      logFilePath,
      `\n${jsonl([
        { type: "text", data: "Done" },
        { type: "end", stopReason: "EndTurn" },
      ])}`,
    );

    expect((await recovery).status).toBe("completed");
    expect(snapshots.some((snapshot) => snapshot.commands === 1)).toBe(true);
    await rm(home, { recursive: true, force: true });
  });

  test("stops a recovery watcher immediately when shutdown aborts it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-abort-"));
    const controller = new AbortController();
    const recovery = waitForChatRunTerminal({
      run: runningRun(join(dir, "missing.jsonl")),
      pollIntervalMs: 10_000,
      startupTimeoutMs: 60_000,
      signal: controller.signal,
    });

    await Bun.sleep(10);
    controller.abort();

    await expect(recovery).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  test("keeps waiting for a quiet run instead of killing it on inactivity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-quiet-"));
    const logFilePath = join(dir, "partial.jsonl");
    let now = Date.parse("2026-07-12T00:00:00.000Z");
    await writeFile(logFilePath, jsonl([{ type: "text", data: "still working" }]));
    // Align file mtime with fake clock so staleness is measured against injected time.
    const epochSeconds = now / 1000;
    await utimes(logFilePath, epochSeconds, epochSeconds);

    const recovery = waitForChatRunTerminal({
      run: runningRun(logFilePath, {
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      }),
      pollIntervalMs: 5,
      startupTimeoutMs: 10_000,
      getNow: () => {
        now += 15;
        return now;
      },
    });

    // Long after any inactivity deadline, the run is still considered alive.
    await Bun.sleep(100);
    await appendFile(
      logFilePath,
      `\n${jsonl([
        { type: "text", data: "finished eventually" },
        { type: "end", stopReason: "EndTurn" },
      ])}`,
    );

    const recovered = await recovery;
    expect(recovered.status).toBe("completed");
    expect(recovered.text).toContain("finished eventually");
    await rm(dir, { recursive: true, force: true });
  });

  test("recovers when a missing log appears after polling begins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-appear-"));
    const logFilePath = join(dir, "later.jsonl");

    const recovery = waitForChatRunTerminal({
      run: runningRun(logFilePath),
      pollIntervalMs: 10,
      startupTimeoutMs: 5_000,
    });

    await Bun.sleep(25);
    await writeFile(
      logFilePath,
      jsonl([
        { type: "text", data: "late output" },
        { type: "end", stopReason: "EndTurn" },
      ]),
    );

    const recovered = await recovery;
    expect(recovered.status).toBe("completed");
    expect(recovered.text).toContain("late output");
    await rm(dir, { recursive: true, force: true });
  });

  test("retries a transient read failure without waiting for a new file signature", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-retry-read-"));
    const logFilePath = join(dir, "retry.jsonl");
    await writeFile(
      logFilePath,
      jsonl([
        { type: "text", data: "recovered after read error" },
        { type: "end", stopReason: "EndTurn" },
      ]),
    );

    const originalReadFile = fsPromises.readFile.bind(fsPromises);
    let readAttempts = 0;
    const readSpy = spyOn(fsPromises, "readFile").mockImplementation(((
      path: Parameters<typeof fsPromises.readFile>[0],
      options?: Parameters<typeof fsPromises.readFile>[1],
    ) => {
      if (String(path) === logFilePath) {
        readAttempts += 1;
        if (readAttempts === 1) return Promise.reject(new Error("EIO transient"));
      }
      return originalReadFile(path, options as never);
    }) as typeof fsPromises.readFile);

    try {
      const recovered = await waitForChatRunTerminal({
        run: runningRun(logFilePath),
        pollIntervalMs: 10,
        startupTimeoutMs: 5_000,
      });
      expect(recovered.status).toBe("completed");
      expect(recovered.text).toContain("recovered after read error");
      expect(readAttempts).toBeGreaterThanOrEqual(2);
    } finally {
      readSpy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const jsonl = (events: unknown[]): string =>
  events.map((event) => JSON.stringify(event)).join("\n");

const runningRun = (logFilePath: string, overrides: Partial<ChatRun> = {}): ChatRun => {
  const now = new Date().toISOString();
  return {
    id: "crun_1",
    session_id: "isess_1",
    user_message_id: "smsg_user",
    assistant_message_id: "smsg_assistant",
    runtime: "grok-build",
    log_file_path: logFilePath,
    status: "running",
    runtime_session_id: null,
    resume_session_id: null,
    failure_kind: null,
    interruption_kind: null,
    context_strategy: "fresh",
    workspace_path: "/tmp/repo",
    timeout_policy: "grok_slow_start_v1",
    retry_of_run_id: null,
    runtime_session_state: null,
    error_message: null,
    delegation_runs: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
};

const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("waitFor timed out");
};
