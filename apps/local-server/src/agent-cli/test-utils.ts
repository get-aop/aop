import type { AgentCliDefinition } from "./definitions.ts";
import { CLAUDE_CODE_CLI } from "./definitions.ts";
import type { CliProbe } from "./probe.ts";
import type { AgentCliRunRepository } from "./run-repository.ts";

/** Claude Code's definition with a fixed channel, so a test never reads ~/.claude/settings.json. */
export const testCli = (overrides: Partial<AgentCliDefinition> = {}): AgentCliDefinition => ({
  ...CLAUDE_CODE_CLI,
  provider: "claude-code",
  readChannel: async () => "latest",
  ...overrides,
});

export const NATIVE_PATH = "/home/me/.local/bin/claude";
export const nativeProbe = (version: string | null): CliProbe => ({
  path: NATIVE_PATH,
  realPath: `/home/me/.local/share/claude/versions/${version ?? "x"}`,
  version,
  error: null,
});

const NPM_PATH = "/usr/local/bin/claude";
export const npmProbe = (version: string | null): CliProbe => ({
  path: NPM_PATH,
  realPath: "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
  version,
  error: null,
});

/** Runs in flight that a test sets by hand, and the version the last finished run named. */
export const fakeRuns = (
  initial = 0,
): AgentCliRunRepository & { set: (count: number) => void; lastVersion: string | null } => {
  let count = initial;
  const runs = {
    lastVersion: null as string | null,
    set: (next: number) => {
      count = next;
    },
    activeRuns: async () => Array.from({ length: count }, (_, i) => ({ logFilePath: `/run-${i}` })),
    lastRunVersion: async () => runs.lastVersion,
    activeRunVersions: async (list: { logFilePath: string }[]) => (list.length ? ["2.1.0"] : []),
  };
  return runs;
};

/** A command a test controls: it resolves when the test calls `finish`. */
export const controlledCommand = () => {
  const calls: string[][] = [];
  let finish: (result: { exitCode: number; output: string }) => void = () => {};
  const run = (argv: string[], onOutput: (chunk: string) => void) => {
    calls.push(argv);
    onOutput("installing…\n");
    return new Promise<{ exitCode: number; output: string }>((resolve) => {
      finish = resolve;
    });
  };
  return { calls, run, finish: (result: { exitCode: number; output: string }) => finish(result) };
};

export const flush = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

export const waitUntil = async (condition: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(2);
  }
};
