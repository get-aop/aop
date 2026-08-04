import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider } from "../types";
import { OpenCodeProvider } from "./opencode";

describe("OpenCodeProvider", () => {
  test("implements LLMProvider interface", () => {
    const provider: LLMProvider = new OpenCodeProvider("opencode-go/kimi-k2.7-code");
    expect(provider.name).toBe("opencode");
    expect(typeof provider.run).toBe("function");
  });

  test("stores the model", () => {
    const provider = new OpenCodeProvider("opencode-go/kimi-k2.7-code");
    expect(provider.model).toBe("opencode-go/kimi-k2.7-code");
  });

  test("delegates launch to an injected runtime adapter", async () => {
    const calls: unknown[] = [];
    const provider = new OpenCodeProvider("opencode-go/kimi-k2.7-code", {
      launch: async (options) => {
        calls.push(options);
        return { exitCode: 0, sessionId: "oc-session-1" };
      },
    });

    const result = await provider.run({ prompt: "test", cwd: "/repo" });

    expect(calls).toEqual([
      { prompt: "test", cwd: "/repo", defaultModel: "opencode-go/kimi-k2.7-code" },
    ]);
    expect(result).toEqual({ exitCode: 0, sessionId: "oc-session-1" });
  });
});

describe("buildCommand", () => {
  test("builds non-interactive JSON run command", () => {
    const provider = new OpenCodeProvider("opencode-go/kimi-k2.7-code");
    expect(
      provider.buildCommand({
        prompt: "test prompt",
        logFilePath: "/tmp/log.txt",
      }),
    ).toEqual([
      "opencode",
      "run",
      "--model",
      "opencode-go/kimi-k2.7-code",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "test prompt",
    ]);
  });

  test("uses runtime alias as the executable", () => {
    const provider = new OpenCodeProvider("opencode-go/kimi-k2.7-code");
    const cmd = provider.buildCommand({
      prompt: "test prompt",
      runtimeAlias: "oc",
    });
    expect(cmd[0]).toBe("oc");
  });

  test("uses the plan agent in native plan mode", () => {
    const provider = new OpenCodeProvider("opencode-go/kimi-k2.7-code");
    expect(
      provider.buildCommand({
        prompt: "plan this",
        mode: "plan",
      }),
    ).toEqual([
      "opencode",
      "run",
      "--model",
      "opencode-go/kimi-k2.7-code",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--agent",
      "plan",
      "plan this",
    ]);
  });

  test("splits known variant suffix into --model and --variant", () => {
    const provider = new OpenCodeProvider("openai/gpt-5.5/xhigh");
    expect(
      provider.buildCommand({
        prompt: "do something",
        logFilePath: "/tmp/out.txt",
      }),
    ).toEqual([
      "opencode",
      "run",
      "--model",
      "openai/gpt-5.5",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--variant",
      "xhigh",
      "do something",
    ]);
  });

  test("maps reasoning effort to variant when model has no suffix", () => {
    const provider = new OpenCodeProvider("openai/gpt-5.5");
    expect(
      provider.buildCommand({
        prompt: "do something",
        reasoningEffort: "high",
      }),
    ).toEqual([
      "opencode",
      "run",
      "--model",
      "openai/gpt-5.5",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--variant",
      "high",
      "do something",
    ]);
  });

  test("maps reasoning effort to variant for GPT 5.5 Fast", () => {
    const provider = new OpenCodeProvider("openai/gpt-5.5-fast");
    expect(
      provider.buildCommand({
        prompt: "do something",
        reasoningEffort: "medium",
      }),
    ).toEqual([
      "opencode",
      "run",
      "--model",
      "openai/gpt-5.5-fast",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--variant",
      "medium",
      "do something",
    ]);
  });

  test("maps max reasoning effort to OpenCode GLM 5.2 variant", () => {
    const provider = new OpenCodeProvider("opencode-go/glm-5.2");
    expect(
      provider.buildCommand({
        prompt: "do something",
        reasoningEffort: "max",
      }),
    ).toEqual([
      "opencode",
      "run",
      "--model",
      "opencode-go/glm-5.2",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--variant",
      "max",
      "do something",
    ]);
  });

  test("passes OpenCode provider routes through unchanged", () => {
    for (const model of [
      "zai-coding-plan/glm-5.2",
      "opencode-go/glm-5.2",
      "opencode-go/kimi-k2.7-code",
    ]) {
      const provider = new OpenCodeProvider(model);
      expect(provider.buildCommand({ prompt: "do something" }).slice(0, 4)).toEqual([
        "opencode",
        "run",
        "--model",
        model,
      ]);
    }
  });

  test("resumes an OpenCode session", () => {
    const provider = new OpenCodeProvider("opencode-go/kimi-k2.7-code");
    expect(
      provider.buildCommand({
        prompt: "continue",
        resumeSessionId: "oc-session-9",
      }),
    ).toEqual([
      "opencode",
      "run",
      "--model",
      "opencode-go/kimi-k2.7-code",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--session",
      "oc-session-9",
      "continue",
    ]);
  });

  test("prefers explicit run model override", () => {
    const provider = new OpenCodeProvider("opencode-go/kimi-k2.7-code");
    expect(
      provider.buildCommand({
        prompt: "test",
        model: "anthropic/claude-sonnet-4",
      }),
    ).toEqual([
      "opencode",
      "run",
      "--model",
      "anthropic/claude-sonnet-4",
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "test",
    ]);
  });
});

describe("OpenCodeProvider run", () => {
  let spawnSpy: ReturnType<typeof spyOn>;
  let logFilePath: string;

  afterEach(() => {
    spawnSpy?.mockRestore();
    if (logFilePath) {
      rmSync(logFilePath, { force: true });
      rmSync(`${logFilePath}.stderr`, { force: true });
    }
  });

  test("stores OpenCode config under AOP_HOME by default", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-opencode-provider-${Date.now()}.jsonl`);

    await new OpenCodeProvider("opencode-go/kimi-k2.7-code").run({
      prompt: "test",
      logFilePath,
      env: { AOP_HOME: "/tmp/aop-home" },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { env: Record<string, string> };
    expect(spawnArgs.env.OPENCODE_CONFIG_DIR).toBe("/tmp/aop-home/opencode");
  });

  test("enforces each session access mode through OpenCode permissions", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    const aopHome = join(tmpdir(), `aop-opencode-access-${crypto.randomUUID()}`);
    logFilePath = join(tmpdir(), `aop-opencode-provider-${Date.now()}.jsonl`);
    const provider = new OpenCodeProvider("opencode-go/kimi-k2.7-code");
    const originalPermission = process.env.OPENCODE_PERMISSION;
    process.env.OPENCODE_PERMISSION = '{"*":"allow"}';

    try {
      const cases = [
        ["approval-required", '{"*":"ask"}'],
        ["auto-accept-edits", '{"edit":"allow","write":"allow","*":"ask"}'],
        ["auto", '{"*":"ask"}'],
        ["full-access", '{"*":"allow"}'],
      ] as const;

      for (const [accessMode, permission] of cases) {
        await provider.run({
          prompt: "test",
          accessMode,
          logFilePath,
          env: { AOP_HOME: aopHome },
        });
        const spawnArgs = spawnSpy.mock.calls.at(-1)?.[0] as {
          cmd: string[];
          env: Record<string, string>;
        };
        expect(spawnArgs.env.OPENCODE_PERMISSION).toBe(permission);
        expect(spawnArgs.cmd.includes("--dangerously-skip-permissions")).toBe(
          accessMode === "full-access",
        );
      }
    } finally {
      if (originalPermission === undefined) delete process.env.OPENCODE_PERMISSION;
      else process.env.OPENCODE_PERMISSION = originalPermission;
      rmSync(aopHome, { recursive: true, force: true });
    }
  });

  test("keeps stderr out of the JSON stdout log", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-opencode-provider-${Date.now()}.jsonl`);

    await new OpenCodeProvider("opencode-go/kimi-k2.7-code").run({ prompt: "test", logFilePath });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { stderr: File; stdout: File };
    expect(spawnArgs.stdout.name).toBe(logFilePath);
    expect(spawnArgs.stderr.name).toBe(`${logFilePath}.stderr`);
  });

  test("returns the OpenCode session id captured in the JSON log", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-opencode-provider-${Date.now()}.jsonl`);
    writeFileSync(logFilePath, JSON.stringify({ type: "session", id: "oc-session-1" }));

    const result = await new OpenCodeProvider("opencode-go/kimi-k2.7-code").run({
      prompt: "test",
      logFilePath,
    });

    expect(result).toEqual({
      exitCode: 0,
      pid: 4242,
      sessionId: "oc-session-1",
      timedOut: false,
    });
  });

  test("ignores nested AOP session ids after capturing an OpenCode session", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-opencode-provider-${Date.now()}.jsonl`);
    writeFileSync(
      logFilePath,
      [
        {
          type: "step_start",
          sessionID: "ses_198534989ffe80cgBkCFvR2UhU",
        },
        {
          type: "tool_result",
          result: { sessionId: "isess_aop-chat" },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );

    const result = await new OpenCodeProvider("openai/gpt-5.5-fast").run({
      prompt: "test",
      logFilePath,
    });

    expect(result.sessionId).toBe("ses_198534989ffe80cgBkCFvR2UhU");
  });

  test("calls onSession when a session id is discovered", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-opencode-provider-${Date.now()}.jsonl`);
    writeFileSync(logFilePath, JSON.stringify({ sessionId: "oc-session-2" }));

    let capturedSessionId: string | undefined;
    await new OpenCodeProvider("opencode-go/kimi-k2.7-code").run({
      prompt: "test",
      logFilePath,
      onSession: (sessionId) => {
        capturedSessionId = sessionId;
      },
    });

    expect(capturedSessionId).toBe("oc-session-2");
  });
});
