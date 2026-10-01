import { describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { appendFile, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatRun } from "../db/schema.ts";
import { detectChatRunTerminalState, waitForChatRunTerminal } from "./chat-run-recovery.ts";
import { turnText } from "./turn-parts.ts";

describe("detectChatRunTerminalState", () => {
  test.each([
    ["codex-cli", [{ type: "turn.completed", "last-assistant-message": "Done" }]],
    ["claude-code", [{ type: "result", subtype: "success", result: "Done" }]],
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
    expect(detectChatRunTerminalState("claude-code", '{"type":"result"')).toBe("running");
    expect(detectChatRunTerminalState("claude-code", jsonl(claudeWorking("wait")))).toBe("running");
  });

  test("does not recover an unsafe runtime session id from a log", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-"));
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(
      logFilePath,
      jsonl([
        ...claudeWorking("Done"),
        { type: "result", subtype: "success", result: "Done", session_id: "--unsafe-resume" },
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
    await writeFile(logFilePath, jsonl([{ type: "result", subtype: "success" }]));

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

  test("forwards log progress while recovering a detached run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-progress-"));
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, `${jsonl(claudeWorking("Polling attempt 12"))}\n`);
    const contents: string[] = [];
    const recovery = waitForChatRunTerminal({
      run: runningRun(logFilePath),
      pollIntervalMs: 10,
      startupTimeoutMs: 5_000,
      onProgress: (parts) => contents.push(turnText(parts)),
    });

    await waitFor(() => contents.some((content) => content.includes("Polling attempt 12")), 2_000);
    await appendFile(
      logFilePath,
      `${jsonl([{ type: "result", subtype: "success", result: "Done" }])}\n`,
    );

    expect((await recovery).status).toBe("completed");
    await rm(dir, { recursive: true, force: true });
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
    await writeFile(logFilePath, jsonl(claudeWorking("still working")));
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
        ...claudeWorking("finished eventually"),
        { type: "result", subtype: "success", result: "finished eventually" },
      ])}`,
    );

    const recovered = await recovery;
    expect(recovered.status).toBe("completed");
    expect(recovered.text).toContain("finished eventually");
    await rm(dir, { recursive: true, force: true });
  });

  test("fails a run whose recorded CLI exited without a final response", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-exited-"));
    const logFilePath = join(dir, "exited.jsonl");
    await writeFile(
      logFilePath,
      `${jsonl([
        { type: "system", subtype: "init", session_id: "sess-exited" },
        { type: "assistant", message: { content: [{ type: "text", text: "Working..." }] } },
      ])}\n`,
    );

    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath, { runtime: "claude-code", pid: 999_999 }),
      isProcessGone: () => true,
      pollIntervalMs: 5,
      startupTimeoutMs: 10_000,
    });

    expect(recovered.status).toBe("failed");
    expect(recovered.text).toContain("exited without a final response");
    expect(recovered.runtimeSessionId).toBe("sess-exited");
    await rm(dir, { recursive: true, force: true });
  });

  test("still recovers the reply when the CLI wrote its ending before exiting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-ended-"));
    const logFilePath = join(dir, "ended.jsonl");
    await writeFile(
      logFilePath,
      `${jsonl([
        { type: "system", subtype: "init", session_id: "sess-ended" },
        { type: "assistant", message: { content: [{ type: "text", text: "All done." }] } },
        { type: "result", subtype: "success", result: "All done." },
      ])}\n`,
    );

    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath, { runtime: "claude-code", pid: 999_999 }),
      isProcessGone: () => true,
      pollIntervalMs: 5,
    });

    expect(recovered.status).toBe("completed");
    expect(recovered.text).toContain("All done.");
    await rm(dir, { recursive: true, force: true });
  });

  test("recovers a run that ended on a usage limit as a wait, not a completed reply", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-limit-"));
    const logFilePath = join(dir, "limit.jsonl");
    const text = "You've hit your session limit · resets 3:45pm";
    await writeFile(
      logFilePath,
      `${jsonl([
        { type: "system", subtype: "init", session_id: "sess-limit" },
        {
          type: "rate_limit_event",
          rate_limit_info: { status: "rejected", resetsAt: 4_102_444_800 },
        },
        { type: "assistant", error: "rate_limit", message: { content: [{ type: "text", text }] } },
        { type: "result", subtype: "success", is_error: true, api_error_status: 429, result: text },
      ])}\n`,
    );

    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath, { runtime: "claude-code" }),
      pollIntervalMs: 5,
    });

    expect(recovered).toMatchObject({
      status: "failed",
      failureKind: "rate_limit",
      runtimeSessionId: "sess-limit",
      rateLimit: { message: text, resetKnown: true },
    });
    expect(recovered.text).toBe(`Runtime error: ${text}`);
    await rm(dir, { recursive: true, force: true });
  });

  test("recovers a run whose CLI died right after a limit flagged its reply", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-limit-exited-"));
    const logFilePath = join(dir, "limit-exited.jsonl");
    await writeFile(
      logFilePath,
      `${jsonl([
        { type: "system", subtype: "init", session_id: "sess-limit" },
        {
          type: "assistant",
          error: "rate_limit",
          message: { content: [{ type: "text", text: "You've hit your session limit" }] },
        },
      ])}\n`,
    );

    const recovered = await waitForChatRunTerminal({
      run: runningRun(logFilePath, { runtime: "claude-code", pid: 999_999 }),
      isProcessGone: () => true,
      pollIntervalMs: 5,
    });

    expect(recovered).toMatchObject({ status: "failed", failureKind: "rate_limit" });
    expect(recovered.rateLimit?.resetKnown).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  test("keeps waiting while the recorded CLI is alive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-chat-recovery-alive-"));
    const logFilePath = join(dir, "alive.jsonl");
    await writeFile(logFilePath, `${jsonl([{ type: "system", session_id: "sess-alive" }])}\n`);
    let processGone = false;

    const recovery = waitForChatRunTerminal({
      run: runningRun(logFilePath, { runtime: "claude-code", pid: 4242 }),
      isProcessGone: () => processGone,
      pollIntervalMs: 5,
      startupTimeoutMs: 10_000,
    });
    let settled = false;
    void recovery.then(() => {
      settled = true;
    });

    await Bun.sleep(60);
    expect(settled).toBe(false);
    processGone = true;
    expect((await recovery).status).toBe("failed");
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
        ...claudeWorking("late output"),
        { type: "result", subtype: "success", result: "late output" },
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
        ...claudeWorking("recovered after read error"),
        { type: "result", subtype: "success", result: "recovered after read error" },
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

/** A Claude assistant message that has not yet ended its turn. */
const claudeWorking = (text: string) => [
  { type: "assistant", message: { content: [{ type: "text", text }] } },
];

const runningRun = (logFilePath: string, overrides: Partial<ChatRun> = {}): ChatRun => {
  const now = new Date().toISOString();
  return {
    id: "crun_1",
    session_id: "isess_1",
    user_message_id: "smsg_user",
    assistant_message_id: "smsg_assistant",
    runtime: "claude-code",
    log_file_path: logFilePath,
    status: "running",
    runtime_session_id: null,
    resume_session_id: null,
    failure_kind: null,
    interruption_kind: null,
    context_strategy: "fresh",
    workspace_path: "/tmp/repo",
    timeout_policy: "default_v1",
    retry_of_run_id: null,
    runtime_session_state: null,
    error_message: null,
    pid: null,
    blocks_json: "[]",
    cli_version: null,
    input_path: null,
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
