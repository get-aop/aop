#!/usr/bin/env bun
// Standalone fake agent CLI for driving the real adapters without a model.
// See ./README.md for how to point an adapter at it and the scripting syntax.
import { writeSync } from "node:fs";
import { createMcpConnection } from "./fake-cli/mcp-client";
import { runFakeCli } from "./fake-cli/run";

const exitCode = await runFakeCli(
  {
    args: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    readStdin: () => Bun.stdin.text(),
  },
  {
    write: (text) => void writeSync(1, text),
    warn: (text) => void writeSync(2, `${text}\n`),
    sleep: (ms) => Bun.sleep(ms),
    crash: () => void process.kill(process.pid, "SIGKILL"),
    mcp: (url) => createMcpConnection(url),
  },
);
process.exit(exitCode);
