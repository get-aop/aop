import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawProviderEvent } from "../logs";
import {
  endInput,
  type InputChannel,
  isInputSettled,
  openInputChannel,
  type RelayIdle,
  relayCommand,
  replayedUuid,
  writeInputLine,
} from "./claude-code-input-channel";

const dirs: string[] = [];
const procs: Bun.Subprocess[] = [];

afterEach(() => {
  for (const proc of procs.splice(0)) {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A relay in front of `cli`, spawned the way the provider spawns it: detached, stdout to the log. */
const startRelay = (cli: string[], idle?: RelayIdle, shell?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "aop-input-channel-"));
  dirs.push(dir);
  const channel: InputChannel = { path: join(dir, "run.in"), promptUuid: "prompt" };
  const log = join(dir, "run.jsonl");
  const { promptPath } = openInputChannel(channel, '{"n":0}\n');
  const command = relayCommand(channel, promptPath, log, cli, idle);
  const proc = Bun.spawn(shell ? [shell, ...command.slice(1)] : command, {
    stdout: Bun.file(log),
    stdin: "ignore",
    stderr: "ignore",
    detached: true,
  });
  procs.push(proc);
  return { channel, log, promptPath, proc };
};

const readLines = (log: string): string[] =>
  existsSync(log) ? readFileSync(log, "utf-8").split("\n").filter(Boolean) : [];

const waitFor = async (check: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(20);
  }
};

describe("the input relay", () => {
  test("hands the CLI the prompt, then each line written, and ends when its input does", async () => {
    // `cat` stands in for the CLI: it writes what it reads to the log and exits at end of input.
    const { channel, log, promptPath, proc } = startRelay(["cat"]);

    await waitFor(() => readLines(log).length === 1);
    expect(readLines(log)).toEqual(['{"n":0}']);
    expect(existsSync(promptPath)).toBe(false);

    expect(await writeInputLine(channel.path, '{"n":1}\n')).toBe(true);
    // A second writer after the first one closed, as a restarted host is: the input stays open.
    await Bun.sleep(100);
    expect(await writeInputLine(channel.path, '{"n":2}\n')).toBe(true);
    await waitFor(() => readLines(log).length === 3);
    expect(readLines(log)).toEqual(['{"n":0}', '{"n":1}', '{"n":2}']);
    expect(proc.exitCode).toBeNull();

    expect(endInput(proc.pid)).toBe(true);
    expect(await proc.exited).toBe(0);
    expect(existsSync(channel.path)).toBe(false);
    expect(await writeInputLine(channel.path, '{"n":3}\n')).toBe(false);
  });

  // Debian and Ubuntu's /bin/sh. macOS ships /bin/dash too, so this runs on every host we build on.
  test.skipIf(!existsSync("/bin/dash"))("ends when its input does under dash too", async () => {
    const { channel, log, proc } = startRelay(["sh", "-c", "cat; exit 3"], undefined, "/bin/dash");
    await waitFor(() => readLines(log).length === 1);
    expect(await writeInputLine(channel.path, '{"n":1}\n')).toBe(true);
    await waitFor(() => readLines(log).length === 2);

    expect(endInput(proc.pid)).toBe(true);
    const exited = await Promise.race([proc.exited, Bun.sleep(3_000).then(() => "still running")]);
    expect(exited).toBe(3);
    expect(existsSync(channel.path)).toBe(false);
  });

  test("takes a line larger than the pipe holds", async () => {
    const { channel, log, proc } = startRelay(["cat"]);
    await waitFor(() => readLines(log).length === 1);
    const big = `${JSON.stringify({ data: "x".repeat(1_000_000) })}\n`;

    expect(await writeInputLine(channel.path, big)).toBe(true);
    endInput(proc.pid);
    expect(await proc.exited).toBe(0);
    expect(readLines(log)[1]).toBe(big.trim());
  });

  test("exits with the CLI's own status", async () => {
    const { log, proc } = startRelay(["sh", "-c", "cat; exit 3"]);
    await waitFor(() => readLines(log).length === 1);
    endInput(proc.pid);
    expect(await proc.exited).toBe(3);
  });

  test("a stop of the relay stops the CLI", async () => {
    const { log, proc } = startRelay(["sh", "-c", "trap 'echo stopped; exit 7' TERM; cat"]);
    await waitFor(() => readLines(log).length === 1);
    proc.kill("SIGTERM");
    expect(await proc.exited).not.toBe(0);
    await waitFor(() => readLines(log).includes("stopped"));
  });

  test("ends when the CLI exits by itself, with its status", async () => {
    const { proc } = startRelay(["sh", "-c", "head -n 1; exit 4"]);
    expect(await proc.exited).toBe(4);
  });

  test("ends the input by itself once the log has been still too long", async () => {
    const { proc } = startRelay(["cat"], { minutes: 0, pollSeconds: 1 });
    expect(await proc.exited).toBe(0);
  });

  test("a write to a run that is gone says so", async () => {
    expect(await writeInputLine(join(tmpdir(), "no-such-aop-fifo"), "{}\n")).toBe(false);
  });

  test("a write as the run starts waits for the relay to read", async () => {
    // Written before the relay is even spawned: the FIFO exists and has no reader yet.
    const dir = mkdtempSync(join(tmpdir(), "aop-input-channel-"));
    dirs.push(dir);
    const channel: InputChannel = { path: join(dir, "run.in"), promptUuid: "prompt" };
    const log = join(dir, "run.jsonl");
    const { promptPath } = openInputChannel(channel, '{"n":0}\n');
    const written = writeInputLine(channel.path, '{"n":1}\n');
    await Bun.sleep(100);
    const proc = Bun.spawn(relayCommand(channel, promptPath, log, ["cat"]), {
      stdout: Bun.file(log),
      stdin: "ignore",
      stderr: "ignore",
      detached: true,
    });
    procs.push(proc);

    expect(await written).toBe(true);
    await waitFor(() => readLines(log).length === 2);
    endInput(proc.pid);
    expect(await proc.exited).toBe(0);
  });
});

const replay = (uuid: string): RawProviderEvent => ({ type: "user", isReplay: true, uuid });
const result: RawProviderEvent = { type: "result", subtype: "success" };
const assistant: RawProviderEvent = { type: "assistant", message: { content: [] } };

describe("isInputSettled", () => {
  test("a run given nothing more is settled at its result", () => {
    expect(isInputSettled([replay("prompt"), assistant], [])).toBe(false);
    expect(isInputSettled([replay("prompt"), assistant, result], [])).toBe(true);
  });

  test("a steer taken mid-turn is answered by the turn's result", () => {
    const events = [replay("prompt"), assistant, replay("s1"), assistant];
    expect(isInputSettled(events, ["s1"])).toBe(false);
    expect(isInputSettled([...events, result], ["s1"])).toBe(true);
  });

  test("a steer not taken yet keeps the run open past a result", () => {
    expect(isInputSettled([replay("prompt"), assistant, result], ["s1"])).toBe(false);
  });

  test("a steer taken after a result needs a result of its own", () => {
    const events = [replay("prompt"), result, replay("s1"), assistant];
    expect(isInputSettled(events, ["s1"])).toBe(false);
    expect(isInputSettled([...events, result], ["s1"])).toBe(true);
  });

  test("lines that only look like a steer do not count", () => {
    const toolResult: RawProviderEvent = { type: "user", uuid: "s1", message: { content: [] } };
    // What the CLI echoes of a message it added itself, such as a background task's notification.
    const own: RawProviderEvent = { ...replay("s1"), origin: { kind: "task-notification" } };
    expect(isInputSettled([toolResult, result], ["s1"])).toBe(false);
    expect(isInputSettled([own, result], ["s1"])).toBe(false);
    expect(replayedUuid(own)).toBeNull();
  });
});
