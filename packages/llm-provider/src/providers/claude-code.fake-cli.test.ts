import { afterAll, describe, expect, test } from "bun:test";
import {
  createFakeCliSandbox,
  FAKE_CLI_PATH,
  readEchoedSystemPrompt,
  readEvents,
  readLog,
  waitFor,
} from "../../test-fixtures/test-utils";
import {
  extractFinalAssistantTextFromRawJsonl,
  extractUsageFromRawJsonl,
  inferRunOutcomeFromRawJsonl,
  parseRawJsonlContent,
} from "../logs";
import type { RunOptions, RunResult } from "../types";
import { ClaudeCodeProvider } from "./claude-code";

// Runs the real ClaudeCodeProvider (real spawn, detach and log redirect) against the
// fake CLI, wired in through `runtimeAlias` exactly as a runtime configuration does.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const cleanup of cleanups) cleanup();
});

const createHarness = () => {
  const sandbox = createFakeCliSandbox();
  const pids: number[] = [];
  let runCount = 0;
  cleanups.push(() => {
    // A failed assertion must not leave a slow fake running in the background.
    for (const pid of pids) killGroup(pid, "SIGKILL");
    sandbox.cleanup();
  });

  const start = (prompt: string, { env, ...overrides }: Partial<RunOptions> = {}) => {
    const logPath = sandbox.logPath(`run-${runCount++}`);
    const spawnedPids: number[] = [];
    const sessionIds: string[] = [];
    const done = new ClaudeCodeProvider().run({
      prompt,
      cwd: sandbox.dir,
      runtimeAlias: FAKE_CLI_PATH,
      logFilePath: logPath,
      env: { FAKE_CLI_HOME: sandbox.home, ...env },
      onSpawn: (pid) => {
        pids.push(pid);
        spawnedPids.push(pid);
      },
      onSession: (sessionId) => {
        sessionIds.push(sessionId);
      },
      ...overrides,
    });
    return { logPath, spawnedPids, sessionIds, done };
  };

  const runToEnd = async (prompt: string, overrides: Partial<RunOptions> = {}) => {
    const run = start(prompt, overrides);
    const result: RunResult = await run.done;
    return { ...run, result, log: readLog(run.logPath), events: readEvents(run.logPath) };
  };

  return { sandbox, start, runToEnd };
};

const killGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    // Detached spawns lead their own process group, which is how the chat engine stops them.
    process.kill(-pid, signal);
  } catch {
    // Already exited.
  }
};

const eventTypes = (events: Array<Record<string, unknown>>): unknown[] =>
  events.map((event) => event.type);

const finalText = (log: string): string => extractFinalAssistantTextFromRawJsonl(log).text;

const toolUses = (events: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
  events.flatMap((event) => {
    const content = (event.message as { content?: unknown[] } | undefined)?.content ?? [];
    return content.filter(
      (block): block is Record<string, unknown> => (block as { type?: string }).type === "tool_use",
    );
  });

describe("ClaudeCodeProvider against the fake CLI", () => {
  test("spawns the fake through runtimeAlias and reports pid, exit code, session id and cwd", async () => {
    const { sandbox, runToEnd } = createHarness();

    const run = await runToEnd("hello there");

    expect(run.result.exitCode).toBe(0);
    expect(run.result.pid).toBe(run.spawnedPids[0]);
    expect(run.result.sessionId).toMatch(UUID);
    expect(run.sessionIds).toEqual([run.result.sessionId as string]);
    expect(eventTypes(run.events)).toEqual(["system", "assistant", "result"]);
    expect(run.events[0]).toMatchObject({ subtype: "init", cwd: sandbox.dir });
    expect(finalText(run.log)).toContain("Fake reply for turn 1");
    expect(finalText(run.log)).toContain("You said: hello there");
  });

  test("its log parses like a real run: success outcome, usage, final reply", async () => {
    const { runToEnd } = createHarness();

    const run = await runToEnd("do two things [fake: steps=2]");

    expect(inferRunOutcomeFromRawJsonl(run.log).outcome).toBe("success");
    expect(extractUsageFromRawJsonl(run.log)).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(finalText(run.log)).toContain("You said: do two things");
    expect(toolUses(run.events)).toHaveLength(2);
  });

  test("streams events into the log while the turn is still running", async () => {
    const { start } = createHarness();

    const run = start("stream it [fake: steps=2 delay=200]");
    await waitFor(() => (readEvents(run.logPath).length > 0 ? true : undefined), "first event");
    const early = readEvents(run.logPath).length;
    const state = await Promise.race([run.done, Bun.sleep(50).then(() => "still running")]);
    const result = await run.done;

    expect(state).toBe("still running");
    const events = readEvents(run.logPath);
    expect(events.length).toBeGreaterThan(early);
    expect(eventTypes(events)).toEqual([
      "system",
      ...Array(2).fill(["assistant", "assistant", "user"]).flat(),
      "assistant",
      "result",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("resumes the same session with --resume and counts the turns", async () => {
    const { runToEnd } = createHarness();

    const first = await runToEnd("remember me");
    const sessionId = first.result.sessionId as string;
    const second = await runToEnd("and again", { resumeSessionId: sessionId });

    expect(second.result.exitCode).toBe(0);
    expect(second.result.sessionId).toBe(sessionId);
    expect(finalText(second.log)).toContain(
      `Fake reply for turn 2 of session ${sessionId} (resumed)`,
    );
  });

  test("the appended system prompt reaches the process on every turn, and an edit reaches a resumed turn", async () => {
    const { runToEnd } = createHarness();

    const first = await runToEnd("one [fake: system]", { appendSystemPrompt: "rules v1" });
    const second = await runToEnd("two [fake: system]", {
      appendSystemPrompt: "rules v2 (edited)",
      resumeSessionId: first.result.sessionId,
    });
    const plain = await runToEnd("three [fake: system]");

    expect(readEchoedSystemPrompt(finalText(first.log))).toBe("rules v1");
    expect(readEchoedSystemPrompt(finalText(second.log))).toBe("rules v2 (edited)");
    expect(finalText(second.log)).toContain("(resumed)");
    expect(readEchoedSystemPrompt(finalText(plain.log))).toBeNull();
  });

  test("refuses to resume a session the CLI never issued", async () => {
    const { runToEnd } = createHarness();

    const run = await runToEnd("hello", { resumeSessionId: crypto.randomUUID() });

    expect(run.result.exitCode).toBe(1);
    expect(run.result.sessionId).toBeUndefined();
    expect(run.events).toEqual([]);
  });

  test("SIGTERM mid-turn leaves no terminal event, and the session resumes with the steer", async () => {
    const { start, runToEnd } = createHarness();

    const run = start("long job [fake: steps=3 delay=30000]");
    const pid = await waitFor(() => run.spawnedPids[0], "spawn");
    await waitFor(() => (readEvents(run.logPath).length > 0 ? true : undefined), "init event");
    killGroup(pid, "SIGTERM");
    const result = await run.done;

    expect(result.exitCode).not.toBe(0);
    expect(eventTypes(readEvents(run.logPath))).toEqual(["system"]);
    expect(result.sessionId).toMatch(UUID);
    const steered = await runToEnd("change of plan", { resumeSessionId: result.sessionId });
    expect(steered.result.exitCode).toBe(0);
    expect(finalText(steered.log)).toContain("turn 2");
  });

  test("a crash mid-turn leaves a torn log line and a session that still resumes", async () => {
    const { runToEnd } = createHarness();

    const crashed = await runToEnd("build it [fake: steps=2 crash=3]");

    expect(crashed.result.exitCode).not.toBe(0);
    expect(parseRawJsonlContent(crashed.log).hasTrailingPartial).toBe(true);
    expect(inferRunOutcomeFromRawJsonl(crashed.log).reason).toBe("trailing-partial-json-line");
    expect(eventTypes(crashed.events)).toEqual(["system", "assistant", "assistant"]);
    expect(crashed.result.sessionId).toMatch(UUID);
    const recovered = await runToEnd("try again", { resumeSessionId: crashed.result.sessionId });
    expect(recovered.result.exitCode).toBe(0);
    expect(finalText(recovered.log)).toContain("turn 2");
  });

  test("a bare non-zero exit reports the code and writes no terminal event", async () => {
    const { runToEnd } = createHarness();

    const run = await runToEnd("die quietly [fake: exit=3]");

    expect(run.result.exitCode).toBe(3);
    expect(eventTypes(run.events)).toEqual(["system"]);
    expect(run.result.sessionId).toMatch(UUID);
  });

  test("a scripted failure writes Claude's error result and exits 1", async () => {
    const { runToEnd } = createHarness();

    const run = await runToEnd('explode [fake: fail="model exploded"]');

    expect(run.result.exitCode).toBe(1);
    expect(run.events.at(-1)).toMatchObject({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["model exploded"],
    });
  });

  test("asks the user through an MCP tool call and receives the answer on resume", async () => {
    const { runToEnd } = createHarness();

    const asked = await runToEnd(
      'Pick a store [fake: ask="Which database?" options="postgres|sqlite"]',
    );

    expect(asked.result.exitCode).toBe(0);
    expect(toolUses(asked.events)).toEqual([
      {
        type: "tool_use",
        id: expect.any(String),
        name: "mcp__aop__aop_ask_user",
        input: { question: "Which database?", options: ["postgres", "sqlite"] },
      },
    ]);
    expect(finalText(asked.log)).toBe("Waiting on your answer.");

    const answered = await runToEnd("sqlite", { resumeSessionId: asked.result.sessionId });
    expect(finalText(answered.log)).toContain("(resumed). You said: sqlite");
  });

  test("asks through Claude's native AskUserQuestion tool when scripted to", async () => {
    const { runToEnd } = createHarness();

    const asked = await runToEnd(
      'Pick [fake: ask="Which one?" options="a|b" tool=AskUserQuestion]',
    );

    const [call] = toolUses(asked.events);
    expect(call).toMatchObject({
      name: "AskUserQuestion",
      input: { questions: [{ question: "Which one?", options: [{ label: "a" }, { label: "b" }] }] },
    });
    const toolResult = asked.events.find((event) => event.type === "user");
    expect(JSON.stringify(toolResult)).toContain('"is_error":true');
  });

  test("FAKE_CLI_SCRIPT scripts every turn of a runtime, and a prompt marker overrides it", async () => {
    const { runToEnd } = createHarness();
    const env = { FAKE_CLI_SCRIPT: "steps=1" };

    const scripted = await runToEnd("plain message", { env });
    const overridden = await runToEnd("plain message [fake: steps=0]", { env });

    expect(toolUses(scripted.events)).toHaveLength(1);
    expect(toolUses(overridden.events)).toHaveLength(0);
  });

  // The watchdog polls every 5s, so these two need the longer timeout and run side by side.
  test.concurrent("the startup watchdog kills a CLI that prints nothing", async () => {
    const { runToEnd } = createHarness();

    const run = await runToEnd("slow boot [fake: startup=30000]", { startupTimeoutMs: 1000 });

    expect(run.result.startupTimedOut).toBe(true);
    expect(run.result.exitCode).not.toBe(0);
    expect(run.events).toEqual([]);
  }, 20_000);

  test.concurrent("the inactivity watchdog kills a CLI that goes quiet mid-turn", async () => {
    const { runToEnd } = createHarness();

    const run = await runToEnd("stall [fake: steps=2 delay=30000]", { inactivityTimeoutMs: 1000 });

    expect(run.result.timedOut).toBe(true);
    expect(run.result.exitCode).not.toBe(0);
    expect(eventTypes(run.events)).toEqual(["system"]);
  }, 20_000);
});
