import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider } from "../types";
import { buildOpenClawResultLog, getOpenClawRawLogPaths, OpenClawProvider } from "./openclaw";

describe("OpenClawProvider", () => {
  test("implements LLMProvider interface", () => {
    const provider: LLMProvider = new OpenClawProvider("ops");
    expect(provider.name).toBe("openclaw");
    expect(typeof provider.run).toBe("function");
  });

  test("stores the target agent id", () => {
    const provider = new OpenClawProvider("ops");
    expect(provider.agentId).toBe("ops");
  });
});

describe("buildCommand", () => {
  test("builds the default local command", () => {
    const provider = new OpenClawProvider("ops");
    expect(provider.buildCommand({ prompt: "review the diff" })).toEqual([
      "openclaw",
      "agent",
      "--agent",
      "ops",
      "--local",
      "--message",
      "review the diff",
    ]);
  });

  test("includes session and thinking overrides when provided", () => {
    const provider = new OpenClawProvider("ops");
    expect(
      provider.buildCommand({
        prompt: "continue the task",
        resumeSessionId: "sess-123",
        reasoningEffort: "xhigh",
      }),
    ).toEqual([
      "openclaw",
      "agent",
      "--agent",
      "ops",
      "--local",
      "--session-id",
      "sess-123",
      "--thinking",
      "xhigh",
      "--message",
      "continue the task",
    ]);
  });
});

describe("buildOpenClawResultLog", () => {
  test("serializes successful output into canonical openclaw JSONL", () => {
    const log = buildOpenClawResultLog({
      stdout: "Finished <aop>ALL_TASKS_DONE</aop>",
      stderr: "",
      exitCode: 0,
    });

    const lines = log.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      provider: "openclaw",
      type: "assistant",
      message: "Finished <aop>ALL_TASKS_DONE</aop>",
    });
    expect(JSON.parse(lines[1] ?? "")).toEqual({
      provider: "openclaw",
      type: "result",
      subtype: "success",
      result: "Finished <aop>ALL_TASKS_DONE</aop>",
    });
  });

  test("serializes failures into an explicit result error event", () => {
    const log = buildOpenClawResultLog({
      stdout: "",
      stderr: "gateway unavailable",
      exitCode: 1,
    });

    expect(log.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(log.trim())).toEqual({
      provider: "openclaw",
      type: "result",
      subtype: "error",
      result: "gateway unavailable",
    });
  });
});

describe("run", () => {
  let spawnSpy: ReturnType<typeof spyOn>;
  let logFilePath: string;

  afterEach(() => {
    spawnSpy?.mockRestore();

    const pathsToCleanup = [
      logFilePath,
      ...(logFilePath ? Object.values(getOpenClawRawLogPaths(logFilePath)) : []),
    ].filter(Boolean);

    for (const path of pathsToCleanup) {
      if (existsSync(path)) {
        rmSync(path, { force: true });
      }
    }
  });

  test("writes canonical JSONL output after the process exits", async () => {
    logFilePath = join(tmpdir(), `aop-openclaw-provider-${Date.now()}.jsonl`);
    const rawPaths = getOpenClawRawLogPaths(logFilePath);
    writeFileSync(rawPaths.stdout, "Finished <aop>ALL_TASKS_DONE</aop>");
    writeFileSync(rawPaths.stderr, "");

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue({
      pid: 90210,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    } as unknown as ReturnType<typeof Bun.spawn>);

    const provider = new OpenClawProvider("ops");
    const result = await provider.run({
      prompt: "implement the task",
      logFilePath,
    });

    expect(result).toEqual({
      exitCode: 0,
      pid: 90210,
      sessionId: undefined,
      timedOut: false,
    });

    expect(Bun.file(logFilePath).text()).resolves.toContain('"provider":"openclaw"');
    expect(Bun.file(logFilePath).text()).resolves.toContain("ALL_TASKS_DONE");
    expect(existsSync(rawPaths.stdout)).toBe(false);
    expect(existsSync(rawPaths.stderr)).toBe(false);
  });
});
