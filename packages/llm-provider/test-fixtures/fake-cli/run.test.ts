import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Io, runFakeCli } from "./run";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const CLAUDE_ARGS = ["--output-format", "stream-json", "--verbose"];

/** Runs the fake in-process with every side effect recorded instead of performed. */
const play = async (
  args: string[],
  env: Record<string, string> = {},
  home = mkdtempSync(join(tmpdir(), "aop-fake-cli-run-")),
) => {
  homes.push(home);
  const io = {
    writes: [] as string[],
    warnings: [] as string[],
    sleeps: [] as number[],
    crashes: 0,
  };
  const recorder: Io = {
    write: (text) => void io.writes.push(text),
    warn: (text) => void io.warnings.push(text),
    sleep: async (ms) => void io.sleeps.push(ms),
    crash: () => {
      io.crashes += 1;
    },
  };
  const exitCode = await runFakeCli(
    { args, env: { FAKE_CLI_HOME: home, ...env }, cwd: "/work" },
    recorder,
  );
  const events = io.writes
    .join("")
    .split("\n")
    .filter((line) => line.endsWith("}"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { ...io, exitCode, events, home };
};

const types = (events: Array<Record<string, unknown>>): unknown[] => events.map((e) => e.type);

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

  test("say replaces the default reply", async () => {
    const run = await play([...CLAUDE_ARGS, 'x [fake: say="custom answer"]']);

    expect(run.events.at(-1)).toMatchObject({ result: "custom answer" });
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
    homes.push(aopHome);

    await play([...CLAUDE_ARGS, "hi"], { FAKE_CLI_HOME: "", AOP_HOME: aopHome });

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
