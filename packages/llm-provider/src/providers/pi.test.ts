import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PiProvider } from "./pi";

describe("PiProvider", () => {
  test("has the Pi provider name", () => {
    const provider = new PiProvider();
    expect(provider.name).toBe("pi");
  });

  test("builds a non-interactive JSON command with model and thinking", () => {
    const provider = new PiProvider();

    expect(
      provider.buildCommand({
        prompt: "Implement the task",
        model: "google/gemini-3-pro",
        reasoningEffort: "high",
      }),
    ).toEqual([
      "pi",
      "--mode",
      "json",
      "--print",
      "--model",
      "google/gemini-3-pro",
      "--thinking",
      "high",
      "Implement the task",
    ]);
  });

  test("uses runtime alias as the executable", () => {
    const provider = new PiProvider();

    expect(provider.buildCommand({ prompt: "Implement the task", runtimeAlias: "pwork" })[0]).toBe(
      "pwork",
    );
  });

  test("rejects native plan mode", () => {
    const provider = new PiProvider();
    expect(() => provider.buildCommand({ prompt: "plan this", mode: "plan" })).toThrow(
      'Provider "pi" does not support native CLI plan mode.',
    );
  });

  test("builds a command that resumes a persisted Pi session", () => {
    const provider = new PiProvider();

    expect(
      provider.buildCommand({
        prompt: "Continue from here",
        resumeSessionId: "pi-session-1",
      }),
    ).toEqual([
      "pi",
      "--mode",
      "json",
      "--print",
      "--session",
      "pi-session-1",
      "Continue from here",
    ]);
  });

  test("delegates launch to an injected runtime adapter", async () => {
    const calls: unknown[] = [];
    const provider = new PiProvider({
      launch: async (options) => {
        calls.push(options);
        return { exitCode: 0, sessionId: "pi-session-1" };
      },
    });

    const result = await provider.run({ prompt: "test", cwd: "/repo" });

    expect(calls).toEqual([{ prompt: "test", cwd: "/repo" }]);
    expect(result).toEqual({ exitCode: 0, sessionId: "pi-session-1" });
  });
});

describe("PiProvider run", () => {
  let spawnSpy: ReturnType<typeof spyOn>;
  let logFilePath: string;

  afterEach(() => {
    spawnSpy?.mockRestore();
    if (logFilePath) {
      rmSync(logFilePath, { force: true });
    }
  });

  test("stores Pi sessions under AOP_HOME by default", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);

    await new PiProvider().run({
      prompt: "test",
      logFilePath,
      env: { AOP_HOME: "/tmp/aop-home" },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { env: Record<string, string> };
    expect(spawnArgs.env.PI_CODING_AGENT_SESSION_DIR).toBe("/tmp/aop-home/pi-sessions");
  });

  test("does not build Pi flags from ambient process environment", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    const aopHome = join(tmpdir(), `aop-pi-guardrails-${crypto.randomUUID()}`);
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);
    const originalModel = process.env.AOP_PI_MODEL;
    const originalThinking = process.env.AOP_PI_THINKING;
    process.env.AOP_PI_MODEL = "ambient/model";
    process.env.AOP_PI_THINKING = "max";

    try {
      await new PiProvider().run({ prompt: "test", logFilePath, env: { AOP_HOME: aopHome } });

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { cmd: string[] };
      expect(spawnArgs.cmd).not.toContain("--model");
      expect(spawnArgs.cmd).not.toContain("ambient/model");
      expect(spawnArgs.cmd).not.toContain("--thinking");
      expect(spawnArgs.cmd).not.toContain("max");
      expect(spawnArgs.cmd).toContain("--extension");
    } finally {
      if (originalModel === undefined) delete process.env.AOP_PI_MODEL;
      else process.env.AOP_PI_MODEL = originalModel;
      if (originalThinking === undefined) delete process.env.AOP_PI_THINKING;
      else process.env.AOP_PI_THINKING = originalThinking;
      rmSync(aopHome, { recursive: true, force: true });
    }
  });

  test("bounds otherwise-unlimited Pi bash calls before chat inactivity expires", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    const aopHome = join(tmpdir(), `aop-pi-guardrails-${crypto.randomUUID()}`);
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);

    try {
      await new PiProvider().run({ prompt: "test", logFilePath, env: { AOP_HOME: aopHome } });

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as {
        cmd: string[];
        env: Record<string, string>;
      };
      const extensionFlag = spawnArgs.cmd.indexOf("--extension");
      const extensionPath = spawnArgs.cmd[extensionFlag + 1];
      expect(extensionFlag).toBeGreaterThan(-1);
      if (!extensionPath) throw new Error("Pi guardrail extension path was not provided");
      expect(readFileSync(extensionPath, "utf-8")).toContain("tool_call");

      let toolCallHandler: ((event: Record<string, unknown>) => void) | undefined;
      const extension = await import(`${pathToFileURL(extensionPath).href}?test=${Date.now()}`);
      extension.default({
        on: (event: string, handler: (toolEvent: Record<string, unknown>) => void) => {
          if (event === "tool_call") toolCallHandler = handler;
        },
      });
      const input: { command: string; timeout?: number } = {
        command: "curl -s http://localhost:3000",
      };
      toolCallHandler?.({ toolName: "bash", input });

      expect(input).toEqual({ command: "curl -s http://localhost:3000", timeout: 240 });
      expect(spawnArgs.env.AOP_PI_BASH_TIMEOUT_SECS).toBe("240");
    } finally {
      rmSync(aopHome, { recursive: true, force: true });
    }
  });

  test("enforces supervised and auto-accept tool policies through the Pi extension", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    const aopHome = join(tmpdir(), `aop-pi-access-${crypto.randomUUID()}`);
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);

    try {
      await new PiProvider().run({
        prompt: "test",
        logFilePath,
        accessMode: "approval-required",
        env: { AOP_HOME: aopHome },
      });

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as {
        cmd: string[];
        env: Record<string, string>;
      };
      expect(spawnArgs.env.AOP_PI_ACCESS_MODE).toBe("approval-required");
      const extensionPath = spawnArgs.cmd[spawnArgs.cmd.indexOf("--extension") + 1];
      if (!extensionPath) throw new Error("Pi guardrail extension path was not provided");

      const invokeTool = async (accessMode: string, toolName: string) => {
        const originalAccessMode = process.env.AOP_PI_ACCESS_MODE;
        process.env.AOP_PI_ACCESS_MODE = accessMode;
        try {
          let toolCallHandler:
            | ((event: Record<string, unknown>) => { block?: boolean; reason?: string } | undefined)
            | undefined;
          const extension = await import(
            `${pathToFileURL(extensionPath).href}?test=${crypto.randomUUID()}`
          );
          extension.default({
            on: (
              event: string,
              handler: (
                toolEvent: Record<string, unknown>,
              ) => { block?: boolean; reason?: string } | undefined,
            ) => {
              if (event === "tool_call") toolCallHandler = handler;
            },
          });
          return toolCallHandler?.({ toolName, input: {} });
        } finally {
          if (originalAccessMode === undefined) delete process.env.AOP_PI_ACCESS_MODE;
          else process.env.AOP_PI_ACCESS_MODE = originalAccessMode;
        }
      };

      expect(await invokeTool("approval-required", "read")).toBeUndefined();
      expect(await invokeTool("approval-required", "write")).toEqual({
        block: true,
        reason: "This action requires approval in Supervised mode. Ask the user before retrying.",
      });
      expect(await invokeTool("auto-accept-edits", "edit")).toBeUndefined();
      expect(await invokeTool("auto-accept-edits", "bash")).toEqual({
        block: true,
        reason:
          "This action requires approval in Auto-accept edits mode. Ask the user before retrying.",
      });
      expect(await invokeTool("auto", "bash")).toEqual({
        block: true,
        reason: "This action requires approval in Supervised mode. Ask the user before retrying.",
      });
      expect(await invokeTool("full-access", "bash")).toBeUndefined();
    } finally {
      rmSync(aopHome, { recursive: true, force: true });
    }
  });

  test("preserves an explicit Pi bash timeout", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    const aopHome = join(tmpdir(), `aop-pi-guardrails-${crypto.randomUUID()}`);
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);

    try {
      await new PiProvider().run({ prompt: "test", logFilePath, env: { AOP_HOME: aopHome } });

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { cmd: string[] };
      const extensionPath = spawnArgs.cmd[spawnArgs.cmd.indexOf("--extension") + 1];
      if (!extensionPath) throw new Error("Pi guardrail extension path was not provided");
      let toolCallHandler: ((event: Record<string, unknown>) => void) | undefined;
      const extension = await import(`${pathToFileURL(extensionPath).href}?test=${Date.now()}`);
      extension.default({
        on: (event: string, handler: (toolEvent: Record<string, unknown>) => void) => {
          if (event === "tool_call") toolCallHandler = handler;
        },
      });
      const input = { command: "bun test", timeout: 600 };
      toolCallHandler?.({ toolName: "bash", input });

      expect(input.timeout).toBe(600);
    } finally {
      rmSync(aopHome, { recursive: true, force: true });
    }
  });

  test("derives the Pi bash guardrail from a longer worker inactivity budget", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    const aopHome = join(tmpdir(), `aop-pi-guardrails-${crypto.randomUUID()}`);
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);

    try {
      await new PiProvider().run({
        prompt: "test",
        logFilePath,
        inactivityTimeoutMs: 30 * 60_000,
        env: { AOP_HOME: aopHome },
      });

      const spawnArgs = spawnSpy.mock.calls[0]?.[0] as {
        cmd: string[];
        env: Record<string, string>;
      };
      expect(spawnArgs.env.AOP_PI_BASH_TIMEOUT_SECS).toBe("1740");

      const extensionPath = spawnArgs.cmd[spawnArgs.cmd.indexOf("--extension") + 1];
      if (!extensionPath) throw new Error("Pi guardrail extension path was not provided");
      const originalTimeout = process.env.AOP_PI_BASH_TIMEOUT_SECS;
      process.env.AOP_PI_BASH_TIMEOUT_SECS = spawnArgs.env.AOP_PI_BASH_TIMEOUT_SECS;
      try {
        let toolCallHandler: ((event: Record<string, unknown>) => void) | undefined;
        const extension = await import(
          `${pathToFileURL(extensionPath).href}?test=${crypto.randomUUID()}`
        );
        extension.default({
          on: (event: string, handler: (toolEvent: Record<string, unknown>) => void) => {
            if (event === "tool_call") toolCallHandler = handler;
          },
        });
        const input: { command: string; timeout?: number } = { command: "bun test" };
        toolCallHandler?.({ toolName: "bash", input });

        expect(input.timeout).toBe(1740);
      } finally {
        if (originalTimeout === undefined) delete process.env.AOP_PI_BASH_TIMEOUT_SECS;
        else process.env.AOP_PI_BASH_TIMEOUT_SECS = originalTimeout;
      }
    } finally {
      rmSync(aopHome, { recursive: true, force: true });
    }
  });

  test("preserves an explicit Pi session directory", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);

    await new PiProvider().run({
      prompt: "test",
      logFilePath,
      env: { PI_CODING_AGENT_SESSION_DIR: "/tmp/custom-pi-sessions" },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { env: Record<string, string> };
    expect(spawnArgs.env.PI_CODING_AGENT_SESSION_DIR).toBe("/tmp/custom-pi-sessions");
  });

  test("keeps Pi stderr out of the JSON stdout log", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);

    await new PiProvider().run({ prompt: "test", logFilePath });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as { stderr: File; stdout: File };
    expect(spawnArgs.stdout.name).toBe(logFilePath);
    expect(spawnArgs.stderr.name).toBe(`${logFilePath}.stderr`);
  });

  test("ignores nested AOP session ids after capturing a Pi session", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-pi-provider-${Date.now()}.jsonl`);
    writeFileSync(
      logFilePath,
      [
        { type: "system", session_id: "pi-session-1" },
        { type: "tool_result", result: { sessionId: "isess_aop-chat" } },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );

    const result = await new PiProvider().run({ prompt: "test", logFilePath });

    expect(result).toEqual({ exitCode: 0, pid: 4242, sessionId: "pi-session-1", timedOut: false });
  });

  test("returns the Pi session id from session events", async () => {
    const mockProc = {
      pid: 4242,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );
    logFilePath = join(tmpdir(), `aop-pi-provider-session-${Date.now()}.jsonl`);
    writeFileSync(logFilePath, JSON.stringify({ type: "session", id: "pi-session-2" }));

    const result = await new PiProvider().run({ prompt: "test", logFilePath });

    expect(result).toEqual({ exitCode: 0, pid: 4242, sessionId: "pi-session-2", timedOut: false });
  });
});
