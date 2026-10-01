import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeProvider } from "./claude-code";

// An agent CLI updated between two turns must be what the next turn runs, with no restart of
// AOP: the command is looked up on the spawn env's PATH at every launch, and a symlink (how the
// native installer switches versions) is followed when the process starts, not before.

const root = mkdtempSync(join(tmpdir(), "aop-spawn-resolution-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const writeVersion = (dir: string, version: string): string => {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, version);
  const init = JSON.stringify({ type: "system", subtype: "init", claude_code_version: version });
  writeFileSync(path, `#!/bin/sh\necho '${init}'\n`);
  chmodSync(path, 0o755);
  return path;
};

// Repoints `link` the way an installer does: a new link beside it, renamed over the old one.
const repoint = (link: string, target: string): void => {
  const staged = `${link}.new`;
  symlinkSync(target, staged);
  renameSync(staged, link);
};

const runOnce = async (bin: string, runtimeAlias: string | undefined, name: string) => {
  const logFilePath = join(root, `${name}.jsonl`);
  const result = await new ClaudeCodeProvider().run({
    prompt: "hello",
    runtimeAlias,
    logFilePath,
    // The test's bin directory first, so the machine's own `claude` is never reached.
    env: { PATH: `${bin}:/usr/bin:/bin` },
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(readFileSync(logFilePath, "utf-8").trim()).claude_code_version as string;
};

describe("ClaudeCodeProvider resolves the CLI at spawn time", () => {
  test("a turn after the symlink moved to a new version runs the new version", async () => {
    const versions = join(root, "native", "versions");
    const bin = join(root, "native", "bin");
    mkdirSync(bin, { recursive: true });
    symlinkSync(writeVersion(versions, "2.1.1"), join(bin, "claude"));

    for (const alias of ["claude", undefined]) {
      repoint(join(bin, "claude"), writeVersion(versions, "2.1.1"));
      expect(await runOnce(bin, alias, `before-${alias}`)).toBe("2.1.1");
      repoint(join(bin, "claude"), writeVersion(versions, "2.1.2"));
      expect(await runOnce(bin, alias, `after-${alias}`)).toBe("2.1.2");
    }
  });

  test("a CLI that moved to another directory on PATH is found there on the next turn", async () => {
    const first = join(root, "moved", "first");
    const second = join(root, "moved", "second");
    const store = join(root, "moved", "store");
    mkdirSync(first, { recursive: true });
    mkdirSync(second, { recursive: true });
    symlinkSync(writeVersion(store, "1.0.0"), join(first, "claude"));
    symlinkSync(writeVersion(store, "1.0.1"), join(second, "claude"));
    const path = `${first}:${second}`;

    expect(await runOnce(path, "claude", "moved-before")).toBe("1.0.0");
    rmSync(join(first, "claude"));
    expect(await runOnce(path, "claude", "moved-after")).toBe("1.0.1");
  });

  test("buildCommand looks the command up on the PATH it is given", () => {
    const bin = join(root, "lookup");
    mkdirSync(bin, { recursive: true });
    const path = writeVersion(bin, "aop-lookup-claude");

    const command = new ClaudeCodeProvider().buildCommand(
      { prompt: "hi", runtimeAlias: "aop-lookup-claude" },
      bin,
    );

    expect(command[0]).toBe(path);
  });
});
