import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider } from "../types";
import { CodexCliProvider } from "./codex-cli";

describe("CodexCliProvider", () => {
  test("implements LLMProvider interface", () => {
    const provider: LLMProvider = new CodexCliProvider();
    expect(provider.name).toBe("codex-cli");
    expect(typeof provider.run).toBe("function");
  });

  test("has readonly name property", () => {
    const provider = new CodexCliProvider();
    expect(provider.name).toBe("codex-cli");
  });
});

describe("buildCommand", () => {
  test("builds the non-interactive codex command", () => {
    const provider = new CodexCliProvider();

    expect(provider.buildCommand({ prompt: "test prompt" })).toEqual([
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "test prompt",
    ]);
  });

  test("uses runtime alias as the executable", () => {
    const provider = new CodexCliProvider();

    expect(provider.buildCommand({ prompt: "test prompt", runtimeAlias: "cdx" })).toEqual([
      "cdx",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "test prompt",
    ]);
  });

  test("maps session access modes to Codex approval and sandbox flags", () => {
    const provider = new CodexCliProvider();

    const supervised = provider.buildCommand({
      prompt: "review",
      accessMode: "approval-required",
    });
    expect(supervised).toContain("untrusted");
    expect(supervised).toContain('approvals_reviewer="user"');
    expect(provider.buildCommand({ prompt: "edit", accessMode: "auto-accept-edits" })).toContain(
      "workspace-write",
    );
    const auto = provider.buildCommand({ prompt: "review", accessMode: "auto" });
    expect(auto).toEqual(
      expect.arrayContaining([
        "--ask-for-approval",
        "on-request",
        "--sandbox",
        "workspace-write",
        "-c",
        'approvals_reviewer="auto_review"',
      ]),
    );
    expect(provider.buildCommand({ prompt: "ship", accessMode: "full-access" })).toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
  });

  test("uses read-only sandbox in plan mode", () => {
    const provider = new CodexCliProvider();

    expect(provider.buildCommand({ prompt: "plan this", mode: "plan" })).toEqual([
      "codex",
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "plan this",
    ]);
  });

  test("adds model when provided through env override", () => {
    const provider = new CodexCliProvider();

    expect(
      provider.buildCommand({ prompt: "test", env: { AOP_CODEX_MODEL: "gpt-5-codex" } }),
    ).toEqual([
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5-codex",
      "test",
    ]);
  });

  test("adds model and reasoning effort from run options", () => {
    const provider = new CodexCliProvider();

    expect(
      provider.buildCommand({
        prompt: "test",
        model: "gpt-5.4",
        reasoningEffort: "xhigh",
      }),
    ).toEqual([
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="xhigh"',
      "test",
    ]);
  });

  test("maps the built-in extra-high effort to Codex xhigh", () => {
    const provider = new CodexCliProvider();

    expect(
      provider.buildCommand({
        prompt: "test",
        model: "gpt-5.6-sol",
        reasoningEffort: "extra-high",
      }),
    ).toContain('model_reasoning_effort="xhigh"');
  });

  test("enables fast_mode when fastMode is true", () => {
    const provider = new CodexCliProvider();

    expect(provider.buildCommand({ prompt: "test", fastMode: true })).toEqual([
      "codex",
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--enable",
      "fast_mode",
      "test",
    ]);
  });

  test("connects AOP platform tools when an MCP URL is provided", () => {
    const provider = new CodexCliProvider();
    const cmd = provider.buildCommand({
      prompt: "Create an AOP workflow",
      mcpServerUrl: "http://127.0.0.1:4310/api/mcp",
    });

    expect(cmd).toContain('mcp_servers.aop.url="http://127.0.0.1:4310/api/mcp"');
    expect(cmd.indexOf('mcp_servers.aop.url="http://127.0.0.1:4310/api/mcp"')).toBeLessThan(
      cmd.indexOf("Create an AOP workflow"),
    );
  });

  test("builds a Codex resume command when a session id is provided", () => {
    const provider = new CodexCliProvider();

    expect(
      provider.buildCommand({
        prompt: "Passwordless",
        mode: "plan",
        resumeSessionId: "codex-thread-1",
        model: "gpt-5.5",
        reasoningEffort: "medium",
      }),
    ).toEqual([
      "codex",
      "exec",
      "resume",
      "--json",
      "--model",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="medium"',
      "codex-thread-1",
      "Passwordless",
    ]);
  });
});

describe("run", () => {
  let spawnSpy: ReturnType<typeof spyOn>;
  let logFilePath: string | undefined;

  afterEach(() => {
    spawnSpy?.mockRestore();
    if (logFilePath) {
      rmSync(logFilePath, { force: true });
      logFilePath = undefined;
    }
  });

  test("spawns detached process with file output", async () => {
    const mockProc = {
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new CodexCliProvider();
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
    });

    expect(result.exitCode).toBe(0);
    expect(result.pid).toBe(31337);

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spawnArgs.detached).toBe(true);
    expect(spawnArgs.stdin).toBe("ignore");
  });

  test("keeps Codex stderr out of the JSON stdout log", async () => {
    const mockProc = {
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const logFilePath = "/tmp/codex-provider.jsonl";
    await new CodexCliProvider().run({ prompt: "test", logFilePath });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { stderr: File; stdout: File };
    expect(spawnArgs.stdout.name).toBe(logFilePath);
    expect(spawnArgs.stderr.name).toBe(`${logFilePath}.stderr`);
  });

  test("uses isolated CODEX_HOME under AOP_HOME while preserving user HOME", async () => {
    const mockProc = {
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new CodexCliProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
      env: { AOP_HOME: "/tmp/aop-home" },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.CODEX_HOME).toBe("/tmp/aop-home/codex-home");
    expect(env.HOME).toBe(process.env.HOME);
  });

  test("preserves explicit CODEX_HOME override", async () => {
    const mockProc = {
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new CodexCliProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
      env: {
        AOP_HOME: "/tmp/aop-home",
        CODEX_HOME: "/tmp/custom-codex-home",
      },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.CODEX_HOME).toBe("/tmp/custom-codex-home");
  });

  test("ignores nested AOP session ids after the Codex thread starts", async () => {
    const mockProc = {
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-codex-provider-${Date.now()}.jsonl`);
    writeFileSync(
      logFilePath,
      [
        { type: "thread.started", thread_id: "codex-thread-1" },
        {
          type: "item.completed",
          item: {
            type: "mcp_tool_call",
            arguments: { sessionId: "isess_aop-chat" },
          },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );

    let capturedSessionId: string | undefined;
    const result = await new CodexCliProvider().run({
      prompt: "test",
      logFilePath,
      onSession: (sessionId) => {
        capturedSessionId = sessionId;
      },
    });

    expect(result.sessionId).toBe("codex-thread-1");
    expect(capturedSessionId).toBe("codex-thread-1");
  });
});
