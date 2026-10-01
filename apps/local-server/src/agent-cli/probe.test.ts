import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeCli, runWithTimeout } from "./probe.ts";
import { testCli } from "./test-utils.ts";

const root = mkdtempSync(join(tmpdir(), "aop-probe-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const SHELL_ENV = { PATH: "/usr/bin:/bin" };

const script = (name: string, body: string): string => {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

const depsFor = (path: string | null) => ({
  locate: () => path,
  resolveLink: realpath,
  run: (argv: string[], timeoutMs: number) => runWithTimeout(argv, timeoutMs, { env: SHELL_ENV }),
});

describe("probeCli", () => {
  test("finds the command, follows its symlink and reads its version", async () => {
    const versions = join(root, "versions");
    mkdirSync(versions);
    const target = join(versions, "2.1.286");
    writeFileSync(target, '#!/bin/sh\necho "2.1.286 (Claude Code)"\n');
    chmodSync(target, 0o755);
    const link = join(root, "claude");
    symlinkSync(target, link);

    expect(await probeCli(testCli(), depsFor(link))).toEqual({
      path: link,
      realPath: await realpath(target),
      version: "2.1.286",
      error: null,
    });
  });

  test("a CLI that is not on PATH is not installed, which is no error", async () => {
    expect(await probeCli(testCli(), depsFor(null))).toEqual({
      path: null,
      realPath: null,
      version: null,
      error: null,
    });
  });

  test("a CLI that prints no version, or fails, says so", async () => {
    const silent = script("silent", "echo hello");
    expect((await probeCli(testCli(), depsFor(silent))).error).toBe(
      "`claude --version` printed no version",
    );
    const broken = script("broken", 'echo "2.1.0"; exit 3');
    expect(await probeCli(testCli(), depsFor(broken))).toMatchObject({ version: null });
  });
});

describe("runWithTimeout", () => {
  test("returns the exit code and both streams, streaming them as they come", async () => {
    const chunks: string[] = [];
    const path = script("both", "echo out; echo err >&2; exit 2");
    const result = await runWithTimeout([path], 5_000, {
      env: SHELL_ENV,
      onOutput: (chunk) => chunks.push(chunk),
    });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("out\n");
    expect(result.output).toContain("err\n");
    expect(chunks.join("")).toContain("out\n");
  });

  test("kills a command that runs past its time", async () => {
    const path = script("slow", "exec sleep 5");
    await expect(runWithTimeout([path], 50, { env: SHELL_ENV })).rejects.toThrow(
      "did not finish within 0.05s",
    );
  });

  test("gives the command no terminal, so a prompt fails instead of hanging", async () => {
    const path = script("prompt", 'read answer || { echo "no input"; exit 1; }');
    const result = await runWithTimeout([path], 5_000, { env: SHELL_ENV });
    expect(result).toEqual({ exitCode: 1, output: "no input\n" });
  });
});
