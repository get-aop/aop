import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createFakeCliSandbox,
  FAKE_CLI_PATH,
  readEvents,
  readLog,
  waitFor,
} from "../../test-fixtures/test-utils";
import { extractFinalAssistantTextFromRawJsonl } from "../logs";
import type { RunOptions } from "../types";
import { ClaudeCodeProvider } from "./claude-code";
import { buildClaudeUserMessage } from "./claude-code-input";
import { endInput, isInputSettled, writeInputLine } from "./claude-code-input-channel";

// The real ClaudeCodeProvider with an input channel, against the fake CLI behind the real relay:
// what a chat run that takes steers does, from spawn to exit.

const sandbox = createFakeCliSandbox();
const pids: number[] = [];
afterAll(() => {
  for (const pid of pids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  sandbox.cleanup();
});

let runs = 0;
const start = (prompt: string, overrides: Partial<RunOptions> = {}) => {
  const name = `run-${runs++}`;
  const logPath = sandbox.logPath(name);
  const channel = { path: join(sandbox.dir, `${name}.in`), promptUuid: `prompt-${name}` };
  let pid = 0;
  const done = new ClaudeCodeProvider().run({
    prompt,
    cwd: sandbox.dir,
    runtimeAlias: FAKE_CLI_PATH,
    logFilePath: logPath,
    partialMessages: true,
    inputChannel: channel,
    env: { FAKE_CLI_HOME: sandbox.home },
    onSpawn: (spawned) => {
      pid = spawned;
      pids.push(spawned);
    },
    ...overrides,
  });
  return { logPath, channel, done, pid: () => pid };
};

const steer = (text: string, uuid: string): string =>
  buildClaudeUserMessage(text, [], undefined, uuid);

/** Ends the run's input once everything it was given is answered, as the chat engine does. */
const endWhenSettled = async (run: ReturnType<typeof start>, steers: string[]) => {
  await waitFor(
    () => (isInputSettled(readEvents(run.logPath), steers) ? true : undefined),
    "the run to answer everything it was given",
  );
  expect(endInput(run.pid())).toBe(true);
};

describe("ClaudeCodeProvider with an input channel", () => {
  test("a message written while the run works reaches the turn and changes its answer", async () => {
    const run = start("build it [fake: steps=3 delay=150]");
    await waitFor(
      () => (readLog(run.logPath).includes('"tool_use"') ? true : undefined),
      "the first tool call",
    );

    expect(
      await writeInputLine(
        run.channel.path,
        steer('use arm64 [fake: say="built for arm64"]', "s1"),
      ),
    ).toBe(true);
    await endWhenSettled(run, ["s1"]);
    const result = await run.done;

    expect(result.exitCode).toBe(0);
    const events = readEvents(run.logPath);
    const replayed = events.filter((event) => event.isReplay === true).map((event) => event.uuid);
    expect(replayed).toEqual([run.channel.promptUuid, "s1"]);
    expect(events.filter((event) => event.type === "result")).toHaveLength(1);
    expect(extractFinalAssistantTextFromRawJsonl(readLog(run.logPath)).text).toBe(
      "built for arm64",
    );
    expect(existsSync(run.channel.path)).toBe(false);
    expect(existsSync(`${run.channel.path}.prompt`)).toBe(false);
  });

  test("a message written after the answer is answered by another turn of the same process", async () => {
    const run = start("first [fake: delay=50]");
    await waitFor(
      () => (readLog(run.logPath).includes('"type":"result"') ? true : undefined),
      "the first answer",
    );
    // The host has not ended the input: the run waits for more.
    expect(run.pid()).toBeGreaterThan(0);

    expect(await writeInputLine(run.channel.path, steer("second", "s1"))).toBe(true);
    await endWhenSettled(run, ["s1"]);

    expect((await run.done).exitCode).toBe(0);
    const results = readEvents(run.logPath).filter((event) => event.type === "result");
    expect(results).toHaveLength(2);
    expect(String(results[1]?.result)).toContain("You said: second");
  });

  test("the prompt's images go in its stream-json line", async () => {
    const image = join(sandbox.dir, "shot.png");
    writeFileSync(image, Buffer.from("png bytes"));
    const run = start("what is this", { images: [{ path: image, mimeType: "image/png" }] });
    await endWhenSettled(run, []);

    expect((await run.done).exitCode).toBe(0);
    expect(extractFinalAssistantTextFromRawJsonl(readLog(run.logPath)).text).toContain(
      "[images: image/png (9 bytes)]",
    );
  });

  test("a run that fails ends by itself, with the CLI's exit code", async () => {
    const run = start("x [fake: fail]");
    expect((await run.done).exitCode).toBe(1);
    expect(existsSync(run.channel.path)).toBe(false);
  });

  test("passes --replay-user-messages and no prompt argument", () => {
    const cmd = new ClaudeCodeProvider().buildCommand({
      prompt: "the prompt",
      inputChannel: { path: "/tmp/x.in", promptUuid: "p" },
    });
    expect(cmd).toContain("--replay-user-messages");
    expect(cmd).toContain("-p");
    expect(cmd.join(" ")).toContain("--input-format stream-json");
    expect(cmd).not.toContain("the prompt");
  });
});
