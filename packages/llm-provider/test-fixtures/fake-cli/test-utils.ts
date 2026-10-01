import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLineQueue } from "./input-lines";
import { type Io, runFakeCli } from "./run";
import type { McpConnection } from "./types";

export const CLAUDE_ARGS = ["--output-format", "stream-json", "--verbose"];

const homes: string[] = [];

/** Call from `afterEach`: removes the session stores `play` created. */
export const removeHomes = (): void => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
};

/** An MCP connection that answers every call with `text`, recording what it was asked. */
export const stubMcp = (text = "ok", isError = false) => {
  const urls: string[] = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const connect = (url: string): McpConnection => {
    urls.push(url);
    return {
      callTool: async (name, args) => {
        calls.push({ name, args });
        return { text, isError };
      },
    };
  };
  return { connect, urls, calls };
};

/** A stream-json user line, as the adapter writes one to stdin. */
export const userLine = (text: string, uuid?: string): string =>
  JSON.stringify({
    type: "user",
    ...(uuid && { uuid }),
    message: { role: "user", content: [{ type: "text", text }] },
  });

/**
 * What the fake reads on stdin: `lines` are there from the start, and each of `later` arrives
 * once the fake has written that many events. The input ends after the last of them.
 */
export interface ScriptedInput {
  lines: string[];
  later?: Array<{ afterEvents: number; line: string }>;
}

/** Runs the fake in-process with every side effect recorded instead of performed. */
export const play = async (
  args: string[],
  env: Record<string, string> = {},
  home = mkdtempSync(join(tmpdir(), "aop-fake-cli-run-")),
  connect: Io["mcp"] = stubMcp().connect,
  cwd = "/work",
  input?: ScriptedInput,
) => {
  homes.push(home);
  const io = {
    writes: [] as string[],
    warnings: [] as string[],
    sleeps: [] as number[],
    crashes: 0,
  };
  const stdin = input ? scripted(input, () => io.writes.length) : undefined;
  const recorder: Io = {
    write: (text) => {
      io.writes.push(text);
      stdin?.arrive();
    },
    warn: (text) => void io.warnings.push(text),
    sleep: async (ms) => void io.sleeps.push(ms),
    crash: () => {
      io.crashes += 1;
    },
    mcp: connect,
  };
  const exitCode = await runFakeCli(
    { args, env: { FAKE_CLI_HOME: home, ...env }, cwd, stdin: stdin?.lines },
    recorder,
  );
  const events = io.writes
    .join("")
    .split("\n")
    .filter((line) => line.endsWith("}"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { ...io, exitCode, events, home };
};

const scripted = (input: ScriptedInput, written: () => number) => {
  const lines = createLineQueue();
  for (const line of input.lines) lines.push(line);
  const later = [...(input.later ?? [])];
  const arrive = () => {
    while (later[0] && written() >= later[0].afterEvents) lines.push(later.shift()?.line ?? "");
    if (later.length === 0) lines.end();
  };
  arrive();
  return { lines, arrive };
};

export const types = (events: Array<Record<string, unknown>>): unknown[] =>
  events.map((event) => event.type);
