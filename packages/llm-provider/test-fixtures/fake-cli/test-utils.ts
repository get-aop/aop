import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Runs the fake in-process with every side effect recorded instead of performed. */
export const play = async (
  args: string[],
  env: Record<string, string> = {},
  home = mkdtempSync(join(tmpdir(), "aop-fake-cli-run-")),
  connect: Io["mcp"] = stubMcp().connect,
  cwd = "/work",
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
    mcp: connect,
  };
  const exitCode = await runFakeCli({ args, env: { FAKE_CLI_HOME: home, ...env }, cwd }, recorder);
  const events = io.writes
    .join("")
    .split("\n")
    .filter((line) => line.endsWith("}"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { ...io, exitCode, events, home };
};

export const types = (events: Array<Record<string, unknown>>): unknown[] =>
  events.map((event) => event.type);
