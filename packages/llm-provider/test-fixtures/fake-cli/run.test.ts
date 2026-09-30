import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLaunches } from "./session-store";
import { CLAUDE_ARGS, play, removeHomes, types } from "./test-utils";
import { readEchoedSystemPrompt } from "./turn";

afterEach(removeHomes);

describe("runFakeCli", () => {
  test("plays a plain turn: init, reply, success result, exit 0", async () => {
    const run = await play([...CLAUDE_ARGS, "hello"]);

    expect(run.exitCode).toBe(0);
    expect(types(run.events)).toEqual(["system", "assistant", "result"]);
    expect(run.warnings).toEqual([]);
  });

  test("sleeps for startup once, then between events but not after the last", async () => {
    const run = await play([...CLAUDE_ARGS, "hi [fake: startup=40 delay=7]"]);

    expect(run.events).toHaveLength(3);
    expect(run.sleeps).toEqual([40, 7, 7]);
  });

  test("crash=N writes N whole events, a torn line, then kills the process", async () => {
    const run = await play([...CLAUDE_ARGS, "hi [fake: steps=2 crash=2]"]);

    expect(run.crashes).toBe(1);
    expect(run.exitCode).toBe(137);
    expect(run.events).toHaveLength(2);
    const torn = run.writes.at(-1) as string;
    expect(torn.endsWith("\n")).toBe(false);
    expect(() => JSON.parse(torn)).toThrow();
    expect(run.writes).toHaveLength(3);
  });

  test("fail writes the error result and exits 1, or the code from exit=", async () => {
    const failed = await play([...CLAUDE_ARGS, 'x [fake: fail="bad"]']);
    const custom = await play([...CLAUDE_ARGS, 'x [fake: fail="bad" exit=7]']);

    expect(failed.exitCode).toBe(1);
    expect(failed.events.at(-1)).toMatchObject({ type: "result", is_error: true });
    expect(failed.warnings).toEqual(["fake-cli: bad"]);
    expect(custom.exitCode).toBe(7);
  });

  test("ratelimit plays a usage limit: exit 1, no reply, and exit= picks another code", async () => {
    const limited = await play([...CLAUDE_ARGS, "x [fake: ratelimit=120]"]);
    const zero = await play([...CLAUDE_ARGS, "x [fake: ratelimit=120 exit=0]"]);

    expect(limited.exitCode).toBe(1);
    expect(types(limited.events)).toEqual(["system", "rate_limit_event", "assistant", "result"]);
    expect(limited.events.at(-1)).toMatchObject({ is_error: true, api_error_status: 429 });
    expect(limited.warnings).toEqual(["fake-cli: usage limit reached, resets in 120s"]);
    expect(zero.exitCode).toBe(0);
  });

  test("exit=N alone exits without a terminal event", async () => {
    const run = await play([...CLAUDE_ARGS, "x [fake: exit=4]"]);

    expect(run.exitCode).toBe(4);
    expect(types(run.events)).toEqual(["system"]);
    expect(run.warnings).toEqual(["fake-cli: exiting with status 4"]);
  });

  test("a question ends the turn waiting for the answer", async () => {
    const run = await play([...CLAUDE_ARGS, 'x [fake: ask="Which?" options="a|b"]']);

    expect(run.exitCode).toBe(0);
    expect(JSON.stringify(run.events)).toContain("mcp__aop__aop_ask_user");
    expect(run.events.at(-1)).toMatchObject({ result: "Waiting on your answer." });
  });

  test("usage= sets the tokens the result reports for the model the adapter asked for", async () => {
    const run = await play([
      ...CLAUDE_ARGS,
      "--model",
      "fake-model",
      "x [fake: usage=1200,340,5000,61000]",
    ]);

    expect(run.events.at(-1)).toMatchObject({
      usage: {
        input_tokens: 1200,
        output_tokens: 340,
        cache_creation_input_tokens: 5000,
        cache_read_input_tokens: 61_000,
      },
      modelUsage: { "fake-model": { inputTokens: 1200, cacheReadInputTokens: 61_000 } },
    });
  });

  test("a launch with no --model reports its usage under fake-claude, and its session records that it passed no flag", async () => {
    const run = await play([...CLAUDE_ARGS, "x [fake: usage=10,5,0,0]"]);
    const sessionId = String(run.events[0]?.session_id);

    expect(run.events.at(-1)).toMatchObject({ modelUsage: { "fake-claude": { inputTokens: 10 } } });
    expect(readLaunches(run.home, "claude", sessionId)).toEqual([
      { turn: 1, flags: ["--output-format", "--verbose"], model: null, effort: null },
    ]);
  });

  test("a resume records its own launch: the flags it passed this time, not the first turn's", async () => {
    const first = await play([...CLAUDE_ARGS, "--model", "m1", "--effort", "high", "one"]);
    const sessionId = String(first.events[0]?.session_id);

    await play([...CLAUDE_ARGS, "--resume", sessionId, "two"], {}, first.home);

    expect(readLaunches(first.home, "claude", sessionId)).toEqual([
      {
        turn: 1,
        flags: ["--output-format", "--verbose", "--model", "--effort"],
        model: "m1",
        effort: "high",
      },
      {
        turn: 2,
        flags: ["--output-format", "--verbose", "--resume"],
        model: null,
        effort: null,
      },
    ]);
  });

  test("write= puts files in the working directory before the first event, and refuses to leave it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "aop-fake-cli-cwd-"));

    const run = await play(
      [...CLAUDE_ARGS, 'x [fake: write="notes.md=first|docs/api.md=second = two|../escape.md=no"]'],
      {},
      undefined,
      undefined,
      cwd,
    );

    expect(readFileSync(join(cwd, "notes.md"), "utf8")).toBe("first");
    expect(readFileSync(join(cwd, "docs", "api.md"), "utf8")).toBe("second = two");
    expect(existsSync(join(cwd, "..", "escape.md"))).toBe(false);
    expect(run.warnings).toEqual([
      "fake-cli: refusing to write outside the working directory: ../escape.md",
    ]);
    expect(run.exitCode).toBe(0);
    rmSync(cwd, { recursive: true, force: true });
  });

  test("say replaces the default reply", async () => {
    const run = await play([...CLAUDE_ARGS, 'x [fake: say="custom answer"]']);

    expect(run.events.at(-1)).toMatchObject({ result: "custom answer" });
  });

  test("[fake: system] echoes the appended system prompt in the reply and the result", async () => {
    const run = await play([
      ...CLAUDE_ARGS,
      "--append-system-prompt",
      "# Brief\nInstructions: keep PRs small.",
      "--system-prompt-snapshot",
      "off",
      "hello [fake: system]",
    ]);

    const reply = (run.events.at(-1)?.result ?? "") as string;
    expect(run.exitCode).toBe(0);
    expect(readEchoedSystemPrompt(reply)).toBe("# Brief\nInstructions: keep PRs small.");
    expect(reply).toContain("You said: hello");
  });

  test("a resume without --system-prompt-snapshot off still sees the first turn's prompt; with it, the new one", async () => {
    const echo = (text: string, snapshot: string[]) => [
      ...CLAUDE_ARGS,
      "--append-system-prompt",
      text,
      ...snapshot,
    ];
    const first = await play([...echo("rules v1", []), "one [fake: system]"]);
    const sessionId = first.events[0]?.session_id as string;
    const resume = (text: string, snapshot: string[]) =>
      play([...echo(text, snapshot), "--resume", sessionId, "two [fake: system]"], {}, first.home);

    const kept = await resume("rules v2", []);
    const fresh = await resume("rules v2", ["--system-prompt-snapshot", "off"]);

    const replyOf = (run: typeof kept) => (run.events.at(-1)?.result ?? "") as string;
    expect(readEchoedSystemPrompt(replyOf(kept))).toBe("rules v1");
    expect(readEchoedSystemPrompt(replyOf(fresh))).toBe("rules v2");
  });

  test("resumes a known session and rejects an unknown one", async () => {
    const first = await play([...CLAUDE_ARGS, "one"]);
    const sessionId = first.events[0]?.session_id as string;

    const resumed = await play([...CLAUDE_ARGS, "--resume", sessionId, "two"], {}, first.home);
    const unknown = await play([...CLAUDE_ARGS, "--resume", "nope", "two"], {}, first.home);

    expect(resumed.events[0]?.session_id).toBe(sessionId);
    expect(resumed.events.at(-1)).toMatchObject({ num_turns: 2 });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.events).toEqual([]);
    expect(unknown.warnings).toEqual(["No conversation found with session ID: nope"]);
  });

  test("keeps session state under AOP_HOME/fake-cli when FAKE_CLI_HOME is unset", async () => {
    const aopHome = mkdtempSync(join(tmpdir(), "aop-fake-cli-aophome-"));

    await play([...CLAUDE_ARGS, "hi"], { FAKE_CLI_HOME: "", AOP_HOME: aopHome }, aopHome);

    expect(existsSync(join(aopHome, "fake-cli", "sessions", "claude"))).toBe(true);
  });

  test("rejects argv it does not recognise and a missing prompt", async () => {
    const unknown = await play(["exec", "--json", "hello"]);
    const empty = await play([...CLAUDE_ARGS]);

    expect(unknown.exitCode).toBe(2);
    expect(empty.exitCode).toBe(1);
    expect(empty.warnings).toEqual(["fake-cli: no prompt given"]);
  });
});
