import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LLMProvider, RunOptions, RunResult } from "@aop/llm-provider";
import type { ChatSession } from "../db/schema.ts";
import { isProcessAlive } from "../executor/process-utils.ts";
import {
  interruptSessionRun,
  isSessionRunActive,
  readAssistantTextFromLog,
  readBoundedUtf8File,
  registerPendingSessionRun,
  releaseSessionRunRegistration,
  runSessionPrompt,
  sessionRunPhase,
} from "./runtime-engine.ts";

const session = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: "isess_run",
  repo_id: "repo_1",
  title: "New session",
  named: false,
  runtime: "claude-code",
  runtime_configuration_id: null,
  model: "claude-opus-4-8",
  reasoning_effort: "medium",
  runtime_alias: null,
  runtime_session_id: null,
  workspace_path: null,
  fast_mode: false,
  runtime_access_mode: "full-access",
  default_worker_id: null,
  default_workflow_id: null,
  pinned: false,
  settled_override: null,
  settled_at: null,
  last_read_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("runSessionPrompt", () => {
  let previousMcpUrl: string | undefined;

  beforeEach(() => {
    previousMcpUrl = process.env.AOP_MCP_URL;
    process.env.AOP_MCP_URL = "http://127.0.0.1:25150/api/mcp";
  });

  afterEach(() => {
    if (previousMcpUrl === undefined) {
      delete process.env.AOP_MCP_URL;
      return;
    }
    process.env.AOP_MCP_URL = previousMcpUrl;
  });

  test("creates OpenCode Sessions providers with the selected model", async () => {
    let providerKey = "";
    const provider: LLMProvider = {
      name: "opencode",
      run: async () => ({ exitCode: 0 }),
    };

    await runSessionPrompt({
      session: session({
        runtime: "opencode",
        model: "openai/gpt-5.6-sol-fast",
      }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: (key) => {
        providerKey = key;
        return provider;
      },
    });

    expect(providerKey).toBe("opencode:openai/gpt-5.6-sol-fast");
  });

  test("passes resume, model, effort, alias, log path, and session callback through the provider seam", async () => {
    const captured: RunOptions[] = [];
    const provider: LLMProvider = {
      name: "fixture",
      run: async (options) => {
        captured.push(options);
        await options.onSession?.("runtime-abc");
        if (options.logFilePath) {
          await mkdir(dirname(options.logFilePath), { recursive: true });
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({
              type: "result",
              subtype: "success",
              result: "hello from fixture",
            })}\n`,
          );
        }
        return { exitCode: 0, sessionId: "runtime-abc" } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({
        runtime_session_id: "prev-sess",
        runtime_alias: "cpe",
        model: "claude-sonnet-4-6",
        reasoning_effort: "high",
        fast_mode: true,
      }),
      repoPath: "/tmp/repo",
      prompt: "what is red?",
      createProviderFn: () => provider,
    });

    const options = captured[0];
    expect(options?.prompt).toBe("what is red?");
    expect(options?.cwd).toBe("/tmp/repo");
    expect(options?.resumeSessionId).toBe("prev-sess");
    expect(options?.runtimeAlias).toBe("cpe");
    expect(options?.model).toBe("claude-sonnet-4-6");
    expect(options?.reasoningEffort).toBe("high");
    expect(options?.fastMode).toBe(true);
    expect(options?.browserControl).toBe(false);
    expect(options?.computerControl).toBe(false);
    expect(options?.isolation).toBe("open");
    expect(options?.disallowedTools).toBeUndefined();
    expect(options?.logFilePath).toBeTruthy();
    expect(options?.startupTimeoutMs).toBe(30_000);
    expect(options?.inactivityTimeoutMs).toBeUndefined();
    expect(options?.env).toMatchObject({
      AOP_CHAT_SESSION_ID: "isess_run",
      AOP_CHAT_WORKSPACE_PATH: "/tmp/repo",
    });
    expect(new URL(options?.mcpServerUrl ?? "http://invalid").searchParams.get("sessionId")).toBe(
      "isess_run",
    );
    expect(
      new URL(options?.mcpServerUrl ?? "http://invalid").searchParams.get("accessToken"),
    ).toBeTruthy();
    expect(result.runtimeSessionId).toBe("runtime-abc");
    expect(result.text).toContain("hello from fixture");
    expect(result.failed).toBeUndefined();
  });

  test("awaits durable session persistence from the provider callback before finalization", async () => {
    let releasePersistence: (() => void) | undefined;
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const provider: LLMProvider = {
      name: "fixture",
      run: async (options) => {
        await options.onSession?.("runtime-before-finalize");
        await writeFile(
          options.logFilePath ?? "",
          `${JSON.stringify({ type: "result", subtype: "success", result: "Done" })}\n`,
        );
        return { exitCode: 0, sessionId: "runtime-before-finalize" };
      },
    };
    let settled = false;
    const run = runSessionPrompt({
      session: session(),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: () => provider,
      onRuntimeSession: () => persistence,
    }).then((result) => {
      settled = true;
      return result;
    });

    await Bun.sleep(10);
    expect(settled).toBe(false);
    releasePersistence?.();
    expect((await run).runtimeSessionId).toBe("runtime-before-finalize");
  });

  test("classifies zero-exit without assistant text as empty_output failure", async () => {
    const provider: LLMProvider = {
      name: "fixture",
      run: async (options) => {
        if (options.logFilePath) {
          await mkdir(dirname(options.logFilePath), { recursive: true });
          await writeFile(
            options.logFilePath,
            `${JSON.stringify({ type: "result", subtype: "success" })}\n`,
          );
        }
        return { exitCode: 0, sessionId: "empty-sess" } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "claude-code", runtime_session_id: "empty-sess" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: () => provider,
    });

    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe("empty_output");
    expect(result.text).not.toContain("Finished via");
  });

  test("accepts completed Grok output after cleaning up a stuck headless process", async () => {
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        await writeFile(
          options.logFilePath ?? "",
          `${JSON.stringify({ type: "text", data: "Delegation complete" })}\n`,
        );
        return {
          exitCode: 143,
          sessionId: "completed-grok-session",
          completedFromSessionEvent: true,
        } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "grok-build" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: () => provider,
    });

    expect(result.failed).toBeUndefined();
    expect(result.text).toBe("Delegation complete");
    expect(result.runtimeSessionId).toBe("completed-grok-session");
  });

  test("classifies provider startup timeout as startup_timeout failure", async () => {
    const provider: LLMProvider = {
      name: "fixture",
      run: async () => ({ exitCode: 1, startupTimedOut: true }) satisfies RunResult,
    };

    const result = await runSessionPrompt({
      session: session({ runtime_session_id: "stale-bind" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: () => provider,
    });

    expect(result.failed).toBe(true);
    expect(result.startupTimedOut).toBe(true);
    expect(result.failureKind).toBe("startup_timeout");
  });

  test("uses the Grok slow-start policy and passes a preallocated fresh id", async () => {
    let options: RunOptions | undefined;
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (next) => {
        options = next;
        return { exitCode: 1, startupTimedOut: true };
      },
    };

    await runSessionPrompt({
      session: session({ runtime: "grok-build" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      newSessionId: "0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f",
      createProviderFn: () => provider,
    });

    expect(options?.newSessionId).toBe("0198c0a8-7d3e-7e96-a8b2-3f1f0c9d4e5f");
    expect(options?.resumeSessionId).toBeUndefined();
    expect(options?.startupTimeoutMs).toBe(120_000);
  });

  test("discovers a runtime id from the active log before provider exit", async () => {
    const logFilePath = join(tmpdir(), `aop-active-session-${Date.now()}.jsonl`);
    let finish: ((result: RunResult) => void) | undefined;
    const finished = new Promise<RunResult>((resolve) => {
      finish = resolve;
    });
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async () => {
        await writeFile(
          logFilePath,
          `${JSON.stringify({ type: "thread.started", thread_id: "early-thread" })}\n`,
        );
        return finished;
      },
    };
    let discovered = "";
    const discoveredPromise = new Promise<void>((resolve) => {
      void runSessionPrompt({
        session: session({ id: "isess_active_tail", runtime: "codex-cli" }),
        repoPath: "/tmp/repo",
        prompt: "hello",
        logFilePath,
        createProviderFn: () => provider,
        onRuntimeSession: (id) => {
          discovered = id;
          resolve();
        },
      });
    });

    await discoveredPromise;
    expect(discovered).toBe("early-thread");
    interruptSessionRun("isess_active_tail", "abort");
    finish?.({ exitCode: 143 });
  });

  test("passes an explicit control capability only to the requesting turn", async () => {
    const captured: RunOptions[] = [];
    const provider: LLMProvider = {
      name: "fixture",
      run: async (options) => {
        captured.push(options);
        return { exitCode: 0 };
      },
    };
    const activeSession = session({ runtime: "codex-cli" });

    await runSessionPrompt({
      session: activeSession,
      repoPath: "/tmp/repo",
      prompt: "Inspect the page",
      control: { provider: "codex-cli", capability: "browser" },
      createProviderFn: () => provider,
    });
    await runSessionPrompt({
      session: activeSession,
      repoPath: "/tmp/repo",
      prompt: "Summarize the result",
      createProviderFn: () => provider,
    });

    expect(captured[0]?.browserControl).toBe(true);
    expect(captured[0]?.computerControl).toBe(false);
    expect(captured[1]?.browserControl).toBe(false);
    expect(captured[1]?.computerControl).toBe(false);
  });

  test.each([
    { capability: "computer" as const, label: "computer" },
    { capability: "browser" as const, label: "browser" },
  ])("terminates leftover $label-control helpers after a successful Codex turn", async ({
    capability,
  }) => {
    // Control turns spawn native helpers (computer_use mouse agent / Playwright MCP)
    // that can outlive `codex exec`. Interrupt already reaps the tree; normal
    // completion must do the same so the desktop/browser session does not stick.
    const dir = await mkdtemp(join(tmpdir(), `aop-${capability}-control-cleanup-`));
    const pidFile = join(dir, "child.pid");
    let childPid = 0;
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        expect(options.browserControl).toBe(capability === "browser");
        expect(options.computerControl).toBe(capability === "computer");
        const script = [
          `const child = Bun.spawn(["sleep", "30"], { detached: true, stdout: "ignore", stderr: "ignore", stdin: "ignore" });`,
          `await Bun.write(${JSON.stringify(pidFile)}, String(child.pid));`,
          // Control turns run for seconds; keep the root briefly so the chat
          // runtime can snapshot the helper pid before reparenting.
          "await Bun.sleep(200);",
          "process.exit(0);",
        ].join("\n");
        const root = Bun.spawn([process.execPath, "-e", script], {
          detached: true,
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
        });
        await options.onSpawn?.(root.pid);
        while (!(await Bun.file(pidFile).exists())) await Bun.sleep(10);
        // Let the control-process tracker sample the detached helper.
        await Bun.sleep(80);
        return { exitCode: await root.exited, pid: root.pid };
      },
    };

    try {
      await runSessionPrompt({
        session: session({ id: `isess_${capability}_cleanup`, runtime: "codex-cli" }),
        repoPath: dir,
        prompt: capability === "browser" ? "Inspect the page" : "Open System Settings",
        control: { provider: "codex-cli", capability },
        createProviderFn: () => provider,
      });
      childPid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
      await Bun.sleep(50);
      expect(isProcessAlive(childPid)).toBe(false);
    } finally {
      if (childPid && isProcessAlive(childPid)) process.kill(childPid, "SIGKILL");
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("recovers a Claude session id from the durable log", async () => {
    const logFilePath = join(tmpdir(), `aop-claude-session-${Date.now()}.jsonl`);
    const provider: LLMProvider = {
      name: "claude-code",
      run: async () => {
        await writeFile(
          logFilePath,
          [
            JSON.stringify({ type: "system", session_id: "claude-session-1" }),
            JSON.stringify({ type: "result", subtype: "success", result: "Done" }),
          ].join("\n"),
        );
        return { exitCode: 0 } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session(),
      repoPath: "/tmp/repo",
      prompt: "hello",
      logFilePath,
      createProviderFn: () => provider,
    });

    expect(result.runtimeSessionId).toBe("claude-session-1");
  });

  test("recovers a fresh runtime session id before returning an interrupted run", async () => {
    const logFilePath = join(tmpdir(), `aop-interrupted-session-${Date.now()}.jsonl`);
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finishProvider: ((result: RunResult) => void) | undefined;
    const providerFinished = new Promise<RunResult>((resolve) => {
      finishProvider = resolve;
    });
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async () => {
        await writeFile(
          logFilePath,
          `${JSON.stringify({ type: "thread.started", thread_id: "codex-thread-1" })}\n`,
        );
        markStarted?.();
        return await providerFinished;
      },
    };

    const run = runSessionPrompt({
      session: session({ id: "isess_interrupted", runtime: "codex-cli" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      logFilePath,
      createProviderFn: () => provider,
    });
    await started;

    expect(interruptSessionRun("isess_interrupted")).toBe(true);
    finishProvider?.({ exitCode: 143 });
    expect((await run).runtimeSessionId).toBe("codex-thread-1");
  });

  test("terminates detached tool subprocesses when a chat run is interrupted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-detached-tool-"));
    const pidFile = join(dir, "child.pid");
    let childPid = 0;
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        const script = [
          `const child = Bun.spawn(["sleep", "30"], { detached: true, stdout: "ignore", stderr: "ignore", stdin: "ignore" });`,
          `await Bun.write(${JSON.stringify(pidFile)}, String(child.pid));`,
          "await child.exited;",
        ].join("\n");
        const root = Bun.spawn([process.execPath, "-e", script], {
          detached: true,
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
        });
        await options.onSpawn?.(root.pid);
        while (!(await Bun.file(pidFile).exists())) await Bun.sleep(10);
        return { exitCode: await root.exited, pid: root.pid };
      },
    };

    try {
      const run = runSessionPrompt({
        session: session({ id: "isess_detached_tool", runtime: "codex-cli" }),
        repoPath: dir,
        prompt: "run tests",
        createProviderFn: () => provider,
      });
      while (!(await Bun.file(pidFile).exists())) await Bun.sleep(10);
      childPid = Number.parseInt(await readFile(pidFile, "utf8"), 10);

      expect(interruptSessionRun("isess_detached_tool", "abort")).toBe(true);
      await run;
      await Bun.sleep(50);

      expect(isProcessAlive(childPid)).toBe(false);
    } finally {
      if (childPid && isProcessAlive(childPid)) process.kill(childPid, "SIGKILL");
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("forces a descendant to exit after the provider root settles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-stubborn-descendant-"));
    const pidFile = join(dir, "child.pid");
    const readyFile = join(dir, "child.ready");
    let rootPid = 0;
    let childPid = 0;
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        const childScript = [
          'process.on("SIGTERM", () => {});',
          `await Bun.write(${JSON.stringify(readyFile)}, "ready");`,
          "setInterval(() => {}, 1_000);",
        ].join("\n");
        const rootScript = [
          `const child = Bun.spawn([process.execPath, "-e", ${JSON.stringify(childScript)}], { detached: true, stdout: "ignore", stderr: "ignore", stdin: "ignore" });`,
          `await Bun.write(${JSON.stringify(pidFile)}, String(child.pid));`,
          `while (!(await Bun.file(${JSON.stringify(readyFile)}).exists())) await Bun.sleep(5);`,
          "await child.exited;",
        ].join("\n");
        const root = Bun.spawn([process.execPath, "-e", rootScript], {
          detached: true,
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
        });
        rootPid = root.pid;
        await options.onSpawn?.(root.pid);
        return { exitCode: await root.exited, pid: root.pid };
      },
    };

    try {
      const run = runSessionPrompt({
        session: session({ id: "isess_stubborn_descendant", runtime: "codex-cli" }),
        repoPath: dir,
        prompt: "run tests",
        createProviderFn: () => provider,
      });
      while (!(await Bun.file(readyFile).exists())) await Bun.sleep(10);
      childPid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
      const parent = Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(childPid)]);
      expect(Number.parseInt(parent.stdout.toString().trim(), 10)).toBe(rootPid);
      process.kill(childPid, "SIGTERM");
      await Bun.sleep(25);
      expect(isProcessAlive(childPid)).toBe(true);

      expect(interruptSessionRun("isess_stubborn_descendant", "abort")).toBe(true);
      await run;

      expect(isProcessAlive(childPid)).toBe(false);
    } finally {
      if (childPid && isProcessAlive(childPid)) process.kill(childPid, "SIGKILL");
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps the runtime running when the capture log exceeds the soft size", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-log-limit-"));
    const logFilePath = join(dir, "run.jsonl");
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        const proc = Bun.spawn(["sleep", "0.15"], {
          detached: true,
          stdout: "ignore",
          stderr: "ignore",
        });
        await options.onSpawn?.(proc.pid);
        await writeFile(logFilePath, "{}");
        await truncate(logFilePath, 2_048);
        return { exitCode: await proc.exited, pid: proc.pid };
      },
    };

    try {
      const result = await runSessionPrompt({
        session: session({ id: "isess_log_limit", runtime: "codex-cli" }),
        repoPath: dir,
        prompt: "produce output",
        logFilePath,
        createProviderFn: () => provider,
        maxLogBytes: 1_024,
        logSizePollMs: 10,
      } as Parameters<typeof runSessionPrompt>[0]);

      // Oversized capture is observability noise, not a kill switch.
      expect(result.aborted).toBeFalsy();
      expect(result.interruptionKind).not.toBe("output_limit");
      expect(result.text).not.toContain("safe output limit");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("surfaces provider failures as readable text", async () => {
    const provider: LLMProvider = {
      name: "fixture",
      run: async () => {
        throw new Error("CLI not found");
      },
    };

    const result = await runSessionPrompt({
      session: session(),
      repoPath: "/tmp/repo",
      prompt: "hi",
      createProviderFn: () => provider,
    });

    expect(result.failed).toBe(true);
    expect(result.text).toContain("CLI not found");
  });

  test("surfaces the provider error recorded before a nonzero exit", async () => {
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        if (!options.logFilePath) throw new Error("expected logFilePath");
        await mkdir(dirname(options.logFilePath), { recursive: true });
        await writeFile(
          options.logFilePath,
          `${JSON.stringify({
            type: "turn.failed",
            error: {
              message: "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade.",
            },
          })}\n`,
        );
        return { exitCode: 1 } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "codex-cli", model: "gpt-5.6-sol" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: () => provider,
    });

    expect(result.failed).toBe(true);
    expect(result.text).toContain("requires a newer version of Codex");
    expect(result.text).not.toContain("Check that the CLI is installed and authenticated");
  });

  test("reports a stale Codex thread without starting a context-free fallback", async () => {
    const logFilePath = join(tmpdir(), `aop-stale-codex-session-${Date.now()}.jsonl`);
    const resumeIds: Array<string | undefined> = [];
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        resumeIds.push(options.resumeSessionId);
        if (options.resumeSessionId) {
          await writeFile(
            logFilePath,
            `${JSON.stringify({
              type: "turn.failed",
              error: {
                message:
                  "thread/resume: thread/resume failed: no rollout found for thread id stale-thread (code -32600)",
              },
            })}\n`,
          );
          return { exitCode: 1 } satisfies RunResult;
        }
        throw new Error("runtime engine must not start the fallback itself");
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "codex-cli", runtime_session_id: "stale-thread" }),
      repoPath: "/tmp/repo",
      prompt: "continue",
      logFilePath,
      createProviderFn: () => provider,
    });

    expect(resumeIds).toEqual(["stale-thread"]);
    expect(result.staleRuntimeSessionId).toBe("stale-thread");
    expect(result.failed).toBe(true);
  });

  test("does not release an interrupted session until the provider exits", async () => {
    let markProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    let finishProvider: ((result: RunResult) => void) | undefined;
    const providerFinished = new Promise<RunResult>((resolve) => {
      finishProvider = resolve;
    });
    const provider: LLMProvider = {
      name: "fixture",
      run: async () => {
        markProviderStarted?.();
        return providerFinished;
      },
    };
    let settled = false;
    const run = runSessionPrompt({
      session: session({ id: "isess_shutdown" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: () => provider,
    }).then((result) => {
      settled = true;
      return result;
    });

    await providerStarted;
    expect(interruptSessionRun("isess_shutdown")).toBe(true);
    await Bun.sleep(60);
    expect(settled).toBe(false);

    finishProvider?.({ exitCode: 143 });
    expect((await run).interrupted).toBe(true);
  });

  test("uses a provider's graceful interrupt signal before forced termination", async () => {
    let finishProvider: ((result: RunResult) => void) | undefined;
    const providerFinished = new Promise<RunResult>((resolve) => {
      finishProvider = resolve;
    });
    const provider = {
      name: "grok-build",
      interruptSignal: "SIGINT",
      run: async (options: RunOptions) => {
        await options.onSpawn?.(77_777);
        return providerFinished;
      },
    } as LLMProvider;
    const kill = spyOn(process, "kill").mockImplementation(() => true);
    const run = runSessionPrompt({
      session: session({ id: "isess_graceful_grok", runtime: "grok-build" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: () => provider,
    });
    await Bun.sleep(5);

    interruptSessionRun("isess_graceful_grok");
    await Bun.sleep(10);
    expect(kill).toHaveBeenCalledWith(-77_777, "SIGINT");

    finishProvider?.({ exitCode: 130 });
    await run;
    kill.mockRestore();
  });

  test("rejects a persisted Grok session with an unfinished tool before spawning", async () => {
    const runtimeSessionId = crypto.randomUUID();
    const repoPath = join(tmpdir(), `aop-unsafe-grok-${crypto.randomUUID()}`);
    const sessionDir = join(
      homedir(),
      ".grok",
      "sessions",
      encodeURIComponent(repoPath),
      runtimeSessionId,
    );
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "events.jsonl"),
      `${JSON.stringify({ type: "turn_started" })}\n${JSON.stringify({
        type: "tool_started",
        tool_name: "get_command_or_subagent_output",
      })}\n`,
    );
    let spawned = false;
    const provider: LLMProvider = {
      name: "grok-build",
      run: async () => {
        spawned = true;
        return { exitCode: 0 };
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "grok-build", runtime_session_id: runtimeSessionId }),
      repoPath,
      prompt: "continue",
      createProviderFn: () => provider,
    });

    expect(spawned).toBe(false);
    expect(result.staleRuntimeSessionId).toBe(runtimeSessionId);
    await rm(join(homedir(), ".grok", "sessions", encodeURIComponent(repoPath)), {
      recursive: true,
      force: true,
    });
  });

  test("unwraps provider errors that prefix a JSON payload", async () => {
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        if (!options.logFilePath) throw new Error("expected logFilePath");
        await mkdir(dirname(options.logFilePath), { recursive: true });
        await writeFile(
          options.logFilePath,
          `${JSON.stringify({
            type: "error",
            message:
              'Internal error: {"message":"API error (status 402 Payment Required): usage balance exhausted","http_status":402}',
          })}\n`,
        );
        return { exitCode: 1 } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "grok-build", model: "grok-4.5" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      createProviderFn: () => provider,
    });

    expect(result.text).toBe(
      "Runtime error: API error (status 402 Payment Required): usage balance exhausted",
    );
  });

  test("extracts codex assistant text from the JSONL log instead of Finished via", async () => {
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        if (!options.logFilePath) throw new Error("expected logFilePath");
        await mkdir(dirname(options.logFilePath), { recursive: true });
        await writeFile(
          options.logFilePath,
          [
            JSON.stringify({
              type: "item.completed",
              item: { type: "agent_message", text: "Exploring." },
            }),
            JSON.stringify({
              type: "turn.completed",
              "last-assistant-message": "Hello from Codex — happy to help.",
            }),
          ].join("\n"),
        );
        return { exitCode: 0 } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "codex-cli", model: "gpt-5.3-codex" }),
      repoPath: "/tmp/repo",
      prompt: "hey",
      createProviderFn: () => provider,
    });

    expect(result.text).toBe("Hello from Codex — happy to help.");
    expect(result.text).not.toContain("Finished via");
  });

  test("concatenates a single Grok text run from streaming tokens", async () => {
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        if (!options.logFilePath) throw new Error("expected logFilePath");
        await mkdir(dirname(options.logFilePath), { recursive: true });
        await writeFile(
          options.logFilePath,
          [
            JSON.stringify({ type: "thought", data: "thinking" }),
            JSON.stringify({ type: "text", data: "Finished via " }),
            JSON.stringify({ type: "text", data: "should not be the fallback — " }),
            JSON.stringify({ type: "text", data: "real grok reply." }),
            JSON.stringify({ type: "end" }),
          ].join("\n"),
        );
        return { exitCode: 0 } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "grok-build", model: "grok-4.5" }),
      repoPath: "/tmp/repo",
      prompt: "hey",
      createProviderFn: () => provider,
    });

    expect(result.text).toBe("Finished via should not be the fallback — real grok reply.");
    expect(result.failed).toBeUndefined();
  });

  test("keeps only the last Grok text run in the final reply (drops status narration)", async () => {
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        if (!options.logFilePath) throw new Error("expected logFilePath");
        await mkdir(dirname(options.logFilePath), { recursive: true });
        await writeFile(
          options.logFilePath,
          [
            JSON.stringify({ type: "thought", data: "planning the change" }),
            JSON.stringify({ type: "text", data: "I'll inspect the session rail layout…" }),
            JSON.stringify({ type: "thought", data: "done inspecting, write the summary" }),
            JSON.stringify({ type: "text", data: "### After\n\n**plus** on each repo folder." }),
            JSON.stringify({ type: "end" }),
          ].join("\n"),
        );
        return { exitCode: 0 } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "grok-build", model: "grok-4.5" }),
      repoPath: "/tmp/repo",
      prompt: "move the button",
      createProviderFn: () => provider,
    });

    expect(result.text).toBe("### After\n\n**plus** on each repo folder.");
    expect(result.text).not.toContain("I'll inspect");
    expect(result.failed).toBeUndefined();
  });

  test("emits onProgress as the provider log grows with thought and text", async () => {
    const progress: Array<{ thinking: string; content: string }> = [];
    const provider: LLMProvider = {
      name: "grok-build",
      run: async (options) => {
        if (!options.logFilePath) throw new Error("expected logFilePath");
        await mkdir(dirname(options.logFilePath), { recursive: true });
        const { appendFile } = await import("node:fs/promises");
        await writeFile(options.logFilePath, "");
        // Give the log tail a couple poll intervals to attach.
        await Bun.sleep(120);
        await appendFile(
          options.logFilePath,
          `${JSON.stringify({ type: "thought", data: "Planning" })}\n`,
        );
        await Bun.sleep(120);
        await appendFile(
          options.logFilePath,
          `${JSON.stringify({ type: "text", data: "Done" })}\n`,
        );
        // Final drain happens when the tail stops after run resolves.
        await Bun.sleep(120);
        return { exitCode: 0 } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "grok-build", model: "grok-4.5" }),
      repoPath: "/tmp/repo",
      prompt: "hey",
      createProviderFn: () => provider,
      onProgress: (s) => progress.push({ thinking: s.thinking, content: s.content }),
    });

    expect(result.text).toBe("Done");
    // Final log read still yields assistant text even if mid-run progress races.
    expect(
      progress.some((p) => p.content.includes("Done") || p.thinking.includes("Planning")),
    ).toBe(true);
  });

  test("fails with empty_output when the log has no assistant text", async () => {
    const provider: LLMProvider = {
      name: "codex-cli",
      run: async (options) => {
        if (!options.logFilePath) throw new Error("expected logFilePath");
        await mkdir(dirname(options.logFilePath), { recursive: true });
        await writeFile(options.logFilePath, `${JSON.stringify({ type: "session", id: "s1" })}\n`);
        return { exitCode: 0, sessionId: "s1" } satisfies RunResult;
      },
    };

    const result = await runSessionPrompt({
      session: session({ runtime: "codex-cli" }),
      repoPath: "/tmp/repo",
      prompt: "hey",
      createProviderFn: () => provider,
    });

    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe("empty_output");
    expect(result.text).not.toContain("Finished via");
    expect(result.runtimeSessionId).toBe("s1");
  });

  test("returns Markdown files created by the runtime as structured artifacts", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "aop-chat-artifacts-"));
    try {
      const init = Bun.spawn(["git", "init", "-b", "main"], {
        cwd: repoPath,
        stdout: "ignore",
        stderr: "pipe",
      });
      expect(await init.exited).toBe(0);
      const provider: LLMProvider = {
        name: "fixture",
        run: async (options) => {
          if (!options.cwd) throw new Error("expected runtime cwd");
          await writeFile(join(options.cwd, "presentation-prep.md"), "# Presentation");
          await writeFile(join(options.cwd, "notes.txt"), "not a Markdown artifact");
          await writeFile(
            options.logFilePath ?? "",
            `${JSON.stringify({ type: "result", subtype: "success", result: "Done" })}\n`,
          );
          return { exitCode: 0 } satisfies RunResult;
        },
      };

      const result = await runSessionPrompt({
        session: session(),
        repoPath,
        prompt: "Prepare me",
        createProviderFn: () => provider,
      });

      expect(result.artifacts).toEqual([
        { path: join(repoPath, "presentation-prep.md"), mimeType: "text/markdown" },
      ]);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});

describe("session run lifecycle registration", () => {
  test("does not let an unrelated caller adopt pending ownership by session id", async () => {
    const registration = registerPendingSessionRun("isess_owned_pending", "claude-code");
    expect(registration).not.toBeNull();
    let factoryCalls = 0;

    const result = await runSessionPrompt({
      session: session({ id: "isess_owned_pending" }),
      repoPath: "/tmp/repo",
      prompt: "unrelated work",
      createProviderFn: () => {
        factoryCalls += 1;
        return { name: "fixture", run: async () => ({ exitCode: 0 }) };
      },
    });

    expect(factoryCalls).toBe(0);
    expect(result.failed).toBe(true);
    expect(result.text).toContain("already in progress");
    if (!registration) throw new Error("expected registration");
    releaseSessionRunRegistration(registration);
  });

  test("cancellation before provider construction prevents the provider factory", async () => {
    const registration = registerPendingSessionRun("isess_cancel_before_factory", "claude-code");
    expect(registration).not.toBeNull();
    expect(sessionRunPhase("isess_cancel_before_factory")).toBe("pending");
    expect(interruptSessionRun("isess_cancel_before_factory", "abort")).toBe(true);
    expect(sessionRunPhase("isess_cancel_before_factory")).toBe("cancelling");

    let factoryCalls = 0;
    const result = await runSessionPrompt({
      session: session({ id: "isess_cancel_before_factory" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      registration: registration ?? undefined,
      createProviderFn: () => {
        factoryCalls += 1;
        return { name: "fixture", run: async () => ({ exitCode: 0 }) };
      },
    });

    expect(factoryCalls).toBe(0);
    expect(result.interrupted).toBe(true);
    expect(result.aborted).toBe(true);
    // Outer lifecycle still owns the registration until release.
    expect(isSessionRunActive("isess_cancel_before_factory")).toBe(true);
    if (!registration) throw new Error("expected registration");
    releaseSessionRunRegistration(registration);
    expect(isSessionRunActive("isess_cancel_before_factory")).toBe(false);
  });

  test("cancellation while spawning terminates the owned process group before completion", async () => {
    const registration = registerPendingSessionRun("isess_cancel_while_spawn", "claude-code");
    expect(registration).not.toBeNull();

    let finishProvider: ((result: RunResult) => void) | undefined;
    const providerFinished = new Promise<RunResult>((resolve) => {
      finishProvider = resolve;
    });
    let enteredRun = false;
    const provider: LLMProvider = {
      name: "fixture",
      run: async (options) => {
        enteredRun = true;
        await options.onSpawn?.(88_001);
        return providerFinished;
      },
    };
    const kill = spyOn(process, "kill").mockImplementation(() => true);
    const run = runSessionPrompt({
      session: session({ id: "isess_cancel_while_spawn" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      registration: registration ?? undefined,
      createProviderFn: () => provider,
    });

    await Bun.sleep(20);
    expect(enteredRun).toBe(true);
    expect(sessionRunPhase("isess_cancel_while_spawn")).toBe("running");
    expect(interruptSessionRun("isess_cancel_while_spawn", "abort")).toBe(true);
    expect(sessionRunPhase("isess_cancel_while_spawn")).toBe("cancelling");
    await Bun.sleep(20);
    expect(kill).toHaveBeenCalledWith(-88_001, "SIGTERM");

    finishProvider?.({ exitCode: 143 });
    const result = await run;
    expect(result.interrupted).toBe(true);
    expect(result.aborted).toBe(true);
    kill.mockRestore();
  });

  test("cancellation before onSpawn terminates the late provider process", async () => {
    const registration = registerPendingSessionRun("isess_cancel_before_spawn", "claude-code");
    expect(registration).not.toBeNull();

    let allowSpawn: (() => void) | undefined;
    const spawnGate = new Promise<void>((resolve) => {
      allowSpawn = resolve;
    });
    let enteredRun = false;
    let finishProvider: ((result: RunResult) => void) | undefined;
    const providerFinished = new Promise<RunResult>((resolve) => {
      finishProvider = resolve;
    });
    const provider: LLMProvider = {
      name: "fixture",
      run: async (options) => {
        enteredRun = true;
        await spawnGate;
        await options.onSpawn?.(88_002);
        return providerFinished;
      },
    };
    const kill = spyOn(process, "kill").mockImplementation(() => true);

    try {
      const run = runSessionPrompt({
        session: session({ id: "isess_cancel_before_spawn" }),
        repoPath: "/tmp/repo",
        prompt: "hello",
        registration: registration ?? undefined,
        createProviderFn: () => provider,
      });

      while (!enteredRun) await Bun.sleep(1);
      const phaseBeforeSpawn = sessionRunPhase("isess_cancel_before_spawn");
      expect(interruptSessionRun("isess_cancel_before_spawn", "abort")).toBe(true);
      allowSpawn?.();
      await Bun.sleep(20);
      finishProvider?.({ exitCode: 143 });
      const result = await run;

      expect(phaseBeforeSpawn).toBe("spawning");
      expect(kill).toHaveBeenCalledWith(-88_002, "SIGTERM");
      expect(result.interrupted).toBe(true);
      expect(result.aborted).toBe(true);
    } finally {
      kill.mockRestore();
      if (registration) releaseSessionRunRegistration(registration);
    }
  });

  test("stale registration release never deletes a newer owner", () => {
    const first = registerPendingSessionRun("isess_ownership", "claude-code");
    expect(first).not.toBeNull();
    if (!first) throw new Error("expected first registration");
    releaseSessionRunRegistration(first);

    const second = registerPendingSessionRun("isess_ownership", "claude-code");
    expect(second).not.toBeNull();
    if (!second) throw new Error("expected second registration");
    expect(second.token).not.toBe(first.token);

    releaseSessionRunRegistration(first);
    expect(isSessionRunActive("isess_ownership")).toBe(true);
    expect(sessionRunPhase("isess_ownership")).toBe("pending");

    releaseSessionRunRegistration(second);
    expect(isSessionRunActive("isess_ownership")).toBe(false);
  });

  test("does not release registration until provider termination has settled", async () => {
    const registration = registerPendingSessionRun("isess_hold_until_exit", "claude-code");
    let finishProvider: ((result: RunResult) => void) | undefined;
    const providerFinished = new Promise<RunResult>((resolve) => {
      finishProvider = resolve;
    });
    let settled = false;
    const run = runSessionPrompt({
      session: session({ id: "isess_hold_until_exit" }),
      repoPath: "/tmp/repo",
      prompt: "hello",
      registration: registration ?? undefined,
      createProviderFn: () => ({
        name: "fixture",
        run: async () => providerFinished,
      }),
    }).then((result) => {
      settled = true;
      return result;
    });

    await Bun.sleep(10);
    expect(interruptSessionRun("isess_hold_until_exit", "abort")).toBe(true);
    await Bun.sleep(40);
    expect(settled).toBe(false);
    expect(isSessionRunActive("isess_hold_until_exit")).toBe(true);

    finishProvider?.({ exitCode: 143 });
    expect((await run).interrupted).toBe(true);
    // Registration is still owned by the outer lifecycle until release is called.
    expect(isSessionRunActive("isess_hold_until_exit")).toBe(true);
    if (!registration) throw new Error("expected registration");
    releaseSessionRunRegistration(registration);
    expect(isSessionRunActive("isess_hold_until_exit")).toBe(false);
  });
});

describe("readAssistantTextFromLog", () => {
  test("reads only a bounded tail of a huge log without loading the full prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-huge-log-"));
    const logFilePath = join(dir, "run.jsonl");
    try {
      // Force the bounded path with a small budget (production uses CHAT_MAX_LOG_BYTES).
      const budget = 256;
      const noise = `${"n".repeat(budget)}\n`;
      const answer = `${JSON.stringify({ type: "text", data: "bounded answer" })}\n`;
      await writeFile(logFilePath, `${noise}${answer}`);
      expect((await Bun.file(logFilePath).arrayBuffer()).byteLength).toBeGreaterThan(budget);
      const text = await readAssistantTextFromLog("codex-cli", logFilePath, budget);
      expect(text).toContain("bounded answer");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns empty string for a missing log file", async () => {
    const text = await readAssistantTextFromLog(
      "codex-cli",
      join(tmpdir(), `missing-chat-log-${Date.now()}.jsonl`),
    );
    expect(text).toBe("");
  });
});

describe("readBoundedUtf8File", () => {
  test("returns null for a missing file", async () => {
    expect(await readBoundedUtf8File("/tmp/aop-missing-log-does-not-exist.jsonl", 1024)).toBeNull();
  });

  test("returns only the trailing budget and skips a partial leading line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-bounded-log-"));
    const path = join(dir, "run.jsonl");
    try {
      const prefix = `${"x".repeat(100)}\n`;
      const keep = '{"type":"text","data":"tail"}\n';
      await writeFile(path, `${prefix}${keep}`);
      const text = await readBoundedUtf8File(path, prefix.length + keep.length - 40);
      expect(text).toBe(keep);
      expect(text?.startsWith("x")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps a complete first line when the tail starts on a line boundary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aop-bounded-aligned-"));
    const path = join(dir, "run.jsonl");
    try {
      const keep = '{"type":"text","data":"aligned-final"}\n';
      const prefix = `${"y".repeat(80)}\n`;
      await writeFile(path, `${prefix}${keep}`);
      // Budget exactly covers keep only — start is right after prefix newline.
      const text = await readBoundedUtf8File(path, keep.length);
      expect(text).toBe(keep);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
