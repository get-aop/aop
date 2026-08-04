import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import type { LLMProvider, RunToolProgress } from "../types";
import {
  AOP_MCP_SERVER_URL_ENV,
  buildGrokSpawnEnv,
  GrokBuildProvider,
  hasUnfinishedGrokTools,
  startGrokJournalTail,
} from "./grok-build";

describe("GrokBuildProvider", () => {
  test("implements LLMProvider interface", () => {
    const provider: LLMProvider = new GrokBuildProvider();
    expect(provider.name).toBe("grok-build");
    expect(typeof provider.run).toBe("function");
  });
});

describe("buildCommand", () => {
  test("builds the headless Grok command", () => {
    const provider = new GrokBuildProvider();

    expect(provider.buildCommand({ prompt: "test prompt" })).toEqual([
      "grok",
      "--no-auto-update",
      "-p",
      "test prompt",
      "--output-format",
      "streaming-json",
      "--permission-mode",
      "bypassPermissions",
    ]);
  });

  test("adds model and effort flags", () => {
    const provider = new GrokBuildProvider();

    expect(
      provider.buildCommand({
        prompt: "test",
        model: "grok-4.5",
        reasoningEffort: "high",
      }),
    ).toEqual([
      "grok",
      "--no-auto-update",
      "-p",
      "test",
      "--output-format",
      "streaming-json",
      "--permission-mode",
      "bypassPermissions",
      "-m",
      "grok-4.5",
      "--effort",
      "high",
    ]);
  });

  test("maps the retired Composer model id for persisted sessions", () => {
    const provider = new GrokBuildProvider();

    expect(
      provider.buildCommand({
        prompt: "test",
        model: "composer-2.5",
      }),
    ).toContain("grok-composer-2.5-fast");
  });

  test("uses the runtime alias as the executable", () => {
    const provider = new GrokBuildProvider();

    expect(
      provider.buildCommand({
        prompt: "test",
        runtimeAlias: "grok-work",
      })[0],
    ).toBe("grok-work");
  });

  test("maps session access modes to Grok permission modes", () => {
    const provider = new GrokBuildProvider();

    expect(provider.buildCommand({ prompt: "review", accessMode: "approval-required" })).toEqual(
      expect.arrayContaining(["--permission-mode", "default"]),
    );
    expect(provider.buildCommand({ prompt: "edit", accessMode: "auto-accept-edits" })).toEqual(
      expect.arrayContaining(["--permission-mode", "acceptEdits"]),
    );
    expect(provider.buildCommand({ prompt: "review", accessMode: "auto" })).toEqual(
      expect.arrayContaining(["--permission-mode", "default"]),
    );
    expect(provider.buildCommand({ prompt: "ship", accessMode: "full-access" })).toEqual(
      expect.arrayContaining(["--permission-mode", "bypassPermissions"]),
    );
  });

  test("enters plan mode with /plan and native plan permissions", () => {
    const provider = new GrokBuildProvider();
    const command = provider.buildCommand({ prompt: "design this", mode: "plan" });

    expect(command).toContain("/plan design this");
    expect(command).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
  });

  test("uses --prompt-file when callers prepare a file for multi-line or dash-leading prompts", () => {
    const provider = new GrokBuildProvider();
    const cmd = provider.buildCommand({
      prompt: "ignored when promptFile is set",
      promptFile: "/tmp/delivery.prompt",
    });
    expect(cmd).toContain("--prompt-file");
    expect(cmd).toContain("/tmp/delivery.prompt");
    expect(cmd).not.toContain("-p");
  });

  test("assigns a fresh UUID without also resuming", () => {
    const provider = new GrokBuildProvider();
    const id = "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f";

    const command = provider.buildCommand({ prompt: "test", newSessionId: id });

    expect(command).toContain("--session-id");
    expect(command).toContain(id);
    expect(command).not.toContain("--resume");
  });

  test("rejects ambiguous or invalid fresh session ids", () => {
    const provider = new GrokBuildProvider();
    expect(() =>
      provider.buildCommand({
        prompt: "test",
        newSessionId: "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
        resumeSessionId: "existing-session",
      }),
    ).toThrow("mutually exclusive");
    expect(() =>
      provider.buildCommand({ prompt: "test", newSessionId: "thread-valid-generic" }),
    ).toThrow("valid UUID");
  });
});

describe("buildGrokSpawnEnv", () => {
  test("passes the authenticated AOP MCP URL for Grok config expansion", () => {
    expect(
      buildGrokSpawnEnv({
        env: { AOP_CHAT_SESSION_ID: "isess_1" },
        mcpServerUrl: "http://127.0.0.1:25150/api/mcp?sessionId=isess_1&accessToken=tok",
      }),
    ).toEqual({
      AOP_CHAT_SESSION_ID: "isess_1",
      [AOP_MCP_SERVER_URL_ENV]: "http://127.0.0.1:25150/api/mcp?sessionId=isess_1&accessToken=tok",
    });
  });

  test("omits the MCP URL env when none is provided", () => {
    expect(buildGrokSpawnEnv({ env: { FOO: "bar" } })).toEqual({ FOO: "bar" });
    expect(buildGrokSpawnEnv({})).toEqual({});
  });
});

describe("Grok journal", () => {
  test("retains a partial JSONL update until the line is complete", async () => {
    const home = `/tmp/aop-grok-home-${crypto.randomUUID()}`;
    const cwd = "/tmp/project";
    const sessionId = crypto.randomUUID();
    const sessionDir = `${home}/.grok/sessions/${encodeURIComponent(cwd)}/${sessionId}`;
    const updatesFilePath = `${sessionDir}/updates.jsonl`;
    await mkdir(sessionDir, { recursive: true });
    await Promise.all([
      writeFile(`${sessionDir}/events.jsonl`, ""),
      writeFile(updatesFilePath, ""),
    ]);
    const progress: RunToolProgress[] = [];
    const tail = startGrokJournalTail({
      cwd,
      sessionId,
      home,
      pollIntervalMs: 10,
      onToolProgress: (event) => progress.push(event),
    });
    const line = JSON.stringify({
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-partial",
          status: "in_progress",
          content: [{ content: { text: "attempt 9" } }],
        },
      },
    });

    await appendFile(updatesFilePath, line.slice(0, -8));
    await Bun.sleep(40);
    expect(progress).toEqual([]);

    await appendFile(updatesFilePath, `${line.slice(-8)}\n`);
    await waitFor(() => progress.length === 1, 2_000);
    expect(progress[0]).toMatchObject({
      id: "call-partial",
      phase: "update",
      detail: "attempt 9",
    });

    await tail.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("reads only updates appended after tailing starts", async () => {
    const home = `/tmp/aop-grok-home-${crypto.randomUUID()}`;
    const cwd = "/tmp/project";
    const sessionId = crypto.randomUUID();
    const sessionDir = `${home}/.grok/sessions/${encodeURIComponent(cwd)}/${sessionId}`;
    const updatesFilePath = `${sessionDir}/updates.jsonl`;
    await mkdir(sessionDir, { recursive: true });
    await Promise.all([
      writeFile(`${sessionDir}/events.jsonl`, ""),
      writeFile(
        updatesFilePath,
        `${JSON.stringify({ params: { update: { sessionUpdate: "tool_call", toolCallId: "old" } } })}\n`,
      ),
    ]);
    const progress: RunToolProgress[] = [];
    const tail = startGrokJournalTail({
      cwd,
      sessionId,
      home,
      pollIntervalMs: 10,
      onToolProgress: (event) => progress.push(event),
    });

    await appendFile(
      updatesFilePath,
      `${JSON.stringify({ params: { update: { sessionUpdate: "tool_call", toolCallId: "new" } } })}\n`,
    );
    await waitFor(() => progress.length === 1, 2_000);

    expect(progress.map((event) => event.id)).toEqual(["new"]);
    await tail.stop();
    await rm(home, { recursive: true, force: true });
  });

  test("detects an unfinished tool in the current persisted turn", async () => {
    const home = `/tmp/aop-grok-home-${crypto.randomUUID()}`;
    const cwd = "/tmp/project";
    const sessionId = crypto.randomUUID();
    const sessionDir = `${home}/.grok/sessions/${encodeURIComponent(cwd)}/${sessionId}`;
    const eventsFilePath = `${sessionDir}/events.jsonl`;
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      eventsFilePath,
      [
        { type: "turn_started" },
        { type: "tool_started", tool_name: "read_file" },
        { type: "tool_completed", tool_name: "read_file" },
        { type: "turn_ended", outcome: "completed" },
        { type: "turn_started" },
        { type: "tool_started", tool_name: "get_command_or_subagent_output" },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );

    expect(await hasUnfinishedGrokTools({ cwd, sessionId, home })).toBe(true);

    await appendFile(
      eventsFilePath,
      `\n${JSON.stringify({ type: "tool_completed", tool_name: "get_command_or_subagent_output" })}\n`,
    );
    expect(await hasUnfinishedGrokTools({ cwd, sessionId, home })).toBe(false);
    await rm(home, { recursive: true, force: true });
  });
});

describe("run", () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  test("spawns detached process with cwd and file output", async () => {
    const mockProc = {
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new GrokBuildProvider();
    const result = await provider.run({
      prompt: "test",
      cwd: "/tmp/project",
      logFilePath: "/tmp/grok.jsonl",
      mcpServerUrl: "http://127.0.0.1:25150/api/mcp?sessionId=s1&accessToken=tok",
    });

    expect(result.exitCode).toBe(0);
    expect(result.pid).toBe(31337);

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spawnArgs.detached).toBe(true);
    expect(spawnArgs.stdin).toBe("ignore");
    expect(spawnArgs.cwd).toBe("/tmp/project");
    expect((spawnArgs.env as Record<string, string>)[AOP_MCP_SERVER_URL_ENV]).toBe(
      "http://127.0.0.1:25150/api/mcp?sessionId=s1&accessToken=tok",
    );
  });

  test("writes multi-line ship prompts to a file so leading --- is not parsed as a flag", async () => {
    const mockProc = {
      pid: 42,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const logFilePath = `/tmp/aop-grok-ship-${Date.now()}.jsonl`;
    const provider = new GrokBuildProvider();
    await provider.run({
      prompt: "---\nname: ship\n---\n# Ship\n\nDo the work",
      logFilePath,
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { cmd: string[] };
    expect(spawnArgs.cmd).toContain("--prompt-file");
    expect(spawnArgs.cmd).toContain(`${logFilePath}.prompt`);
    expect(spawnArgs.cmd).not.toContain("-p");
    const written = await Bun.file(`${logFilePath}.prompt`).text();
    expect(written.startsWith("---")).toBe(true);
  });

  test("does not promote a preallocated id merely because the process spawned", async () => {
    const logFilePath = `/tmp/aop-grok-allocated-${crypto.randomUUID()}.jsonl`;
    await writeFile(logFilePath, "");
    const onSession = mock(() => {});
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      pid: 43,
      exited: Promise.resolve(1),
      kill: mock(() => {}),
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof Bun.spawn>);

    await new GrokBuildProvider().run({
      prompt: "test",
      logFilePath,
      newSessionId: "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
      onSession,
    });

    expect(onSession).not.toHaveBeenCalled();
    await rm(logFilePath, { force: true });
  });

  test("ignores nested AOP session ids after capturing a Grok session", async () => {
    const logFilePath = `/tmp/aop-grok-nested-session-${crypto.randomUUID()}.jsonl`;
    const runtimeSessionId = "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f";
    await writeFile(
      logFilePath,
      [
        { type: "end", session_id: runtimeSessionId },
        { type: "tool_result", result: { sessionId: "isess_aop-chat" } },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      pid: 44,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof Bun.spawn>);

    const result = await new GrokBuildProvider().run({ prompt: "test", logFilePath });

    expect(result.sessionId).toBe(runtimeSessionId);
    await rm(logFilePath, { force: true });
  });

  test("finishes when Grok records a completed turn but the headless process stays open", async () => {
    const home = `/tmp/aop-grok-home-${crypto.randomUUID()}`;
    const cwd = "/tmp/project";
    const runtimeSessionId = crypto.randomUUID();
    const logFilePath = `/tmp/aop-grok-completed-turn-${crypto.randomUUID()}.jsonl`;
    const eventsFilePath = `${home}/.grok/sessions/${encodeURIComponent(cwd)}/${runtimeSessionId}/events.jsonl`;
    await mkdir(eventsFilePath.slice(0, eventsFilePath.lastIndexOf("/")), { recursive: true });
    await writeFile(eventsFilePath, "");
    await writeFile(logFilePath, `${JSON.stringify({ type: "text", data: "Done" })}\n`);

    let resolveExit: (exitCode: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
      setTimeout(() => resolve(1), 2_000);
    });
    const kill = mock(() => resolveExit(143));
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      pid: 45,
      exited,
      kill,
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof Bun.spawn>);

    const resultPromise = new GrokBuildProvider().run({
      prompt: "test",
      cwd,
      env: { HOME: home },
      logFilePath,
      newSessionId: runtimeSessionId,
    });
    await appendFile(
      eventsFilePath,
      `${JSON.stringify({ type: "turn_ended", outcome: "completed" })}\n`,
    );

    const result = (await resultPromise) as Awaited<typeof resultPromise> & {
      completedFromSessionEvent?: boolean;
    };
    expect(result.completedFromSessionEvent).toBe(true);
    expect(result.sessionId).toBe(runtimeSessionId);
    expect(kill).toHaveBeenCalledTimes(1);

    await rm(home, { recursive: true, force: true });
    await rm(logFilePath, { force: true });
  });

  test("forwards native Grok tool starts, output updates, and completion", async () => {
    const home = `/tmp/aop-grok-home-${crypto.randomUUID()}`;
    const cwd = "/tmp/project";
    const runtimeSessionId = crypto.randomUUID();
    const sessionDir = `${home}/.grok/sessions/${encodeURIComponent(cwd)}/${runtimeSessionId}`;
    const eventsFilePath = `${sessionDir}/events.jsonl`;
    const updatesFilePath = `${sessionDir}/updates.jsonl`;
    const logFilePath = `/tmp/aop-grok-progress-${crypto.randomUUID()}.jsonl`;
    await mkdir(sessionDir, { recursive: true });
    await Promise.all([
      writeFile(eventsFilePath, ""),
      writeFile(updatesFilePath, ""),
      writeFile(logFilePath, `${JSON.stringify({ type: "text", data: "Done" })}\n`),
    ]);

    let resolveExit: (exitCode: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
      setTimeout(() => resolve(1), 2_000);
    });
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      pid: 46,
      exited,
      kill: mock(() => resolveExit(143)),
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof Bun.spawn>);
    const progress: RunToolProgress[] = [];
    const onActivity = mock(() => {});

    const resultPromise = new GrokBuildProvider().run({
      prompt: "test",
      cwd,
      env: { HOME: home },
      logFilePath,
      newSessionId: runtimeSessionId,
      onToolProgress: (event) => progress.push(event),
      onActivity,
    });
    await appendFile(
      updatesFilePath,
      `${[
        {
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "call-42",
              title: "run_terminal_command",
              rawInput: { description: "Poll API readiness" },
            },
          },
        },
        {
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "call-42",
              status: "in_progress",
              content: [{ type: "content", content: { type: "text", text: "attempt 4: api=000" } }],
            },
          },
        },
        {
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "call-42",
              status: "completed",
            },
          },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n")}\n`,
    );
    await Bun.sleep(300);
    await appendFile(
      eventsFilePath,
      `${JSON.stringify({ type: "turn_ended", outcome: "completed" })}\n`,
    );
    await resultPromise;

    expect(progress).toEqual([
      {
        id: "call-42",
        phase: "start",
        name: "run_terminal_command",
        detail: "Poll API readiness",
      },
      {
        id: "call-42",
        phase: "update",
        name: undefined,
        detail: "attempt 4: api=000",
      },
      {
        id: "call-42",
        phase: "done",
        name: undefined,
        detail: undefined,
        failed: false,
      },
    ]);
    expect(onActivity).toHaveBeenCalledTimes(3);

    await rm(home, { recursive: true, force: true });
    await rm(logFilePath, { force: true });
  });

  test("fails when Grok returns a different id than the preallocated id", async () => {
    const logFilePath = `/tmp/aop-grok-mismatch-${crypto.randomUUID()}.jsonl`;
    await writeFile(
      logFilePath,
      `${JSON.stringify({ type: "end", session_id: "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e50" })}\n`,
    );
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      pid: 44,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof Bun.spawn>);

    await expect(
      new GrokBuildProvider().run({
        prompt: "test",
        logFilePath,
        newSessionId: "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
      }),
    ).rejects.toThrow("expected preassigned id");
    await rm(logFilePath, { force: true });
  });
});

const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("waitFor timed out");
};
