import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseRawJsonlContent } from "../src/logs";

export { readLaunches } from "./fake-cli/session-store";
export { readEchoedSystemPrompt } from "./fake-cli/turn";

/** Absolute path to hand an adapter as `runtimeAlias`. */
export const FAKE_CLI_PATH = resolve(import.meta.dir, "fake-cli.ts");

export interface FakeCliSandbox {
  /** Real path (macOS tmp is a symlink), so it compares equal to the fake's `process.cwd()`. */
  dir: string;
  /** Pass as `FAKE_CLI_HOME` so session state never leaks between tests. */
  home: string;
  logPath(name: string): string;
  cleanup(): void;
}

export const createFakeCliSandbox = (): FakeCliSandbox => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "aop-fake-cli-")));
  return {
    dir,
    home: join(dir, "fake-cli-home"),
    logPath: (name) => join(dir, `${name}.jsonl`),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

export const readLog = (logPath: string): string =>
  existsSync(logPath) ? readFileSync(logPath, "utf8") : "";

/** Complete JSONL events in the log; a torn trailing line is left out. */
export const readEvents = (logPath: string): Record<string, unknown>[] =>
  parseRawJsonlContent(readLog(logPath)).entries.map((entry) => entry.event);

/** Polls until `probe` returns something other than undefined. */
export const waitFor = async <T>(
  probe: () => T | undefined,
  description: string,
  timeoutMs = 10_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== undefined) return value;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
};
