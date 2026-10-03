#!/usr/bin/env bun
// Standalone fake agent CLI for driving the real adapters without a model.
// See ./README.md for how to point an adapter at it and the scripting syntax.
import { writeSync } from "node:fs";
import { linesOf } from "./fake-cli/input-lines";
import { createMcpConnection } from "./fake-cli/mcp-client";
import { answerMetaCommand } from "./fake-cli/meta";
import { runFakeCli } from "./fake-cli/run";

const metaExitCode = answerMetaCommand(process.argv.slice(2), process.env, (text) =>
  writeSync(1, text),
);
if (metaExitCode !== null) process.exit(metaExitCode);

const exitCode = await runFakeCli(
  {
    args: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    stdin: linesOf(Bun.stdin.stream()),
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
