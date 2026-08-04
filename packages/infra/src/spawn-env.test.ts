import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { buildClaudeCodeSpawnEnv, buildSpawnEnv, resetSpawnEnvCacheForTests } from "./spawn-env.ts";

let tempDir: string | undefined;

describe("spawn-env", () => {
  let spawnSyncSpy: ReturnType<typeof spyOn> | undefined;
  const originalAopHome = process.env.AOP_HOME;
  const originalAopRealGit = process.env.AOP_REAL_GIT;
  const originalDisableLoginShellEnv = process.env.AOP_DISABLE_LOGIN_SHELL_ENV;
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    resetSpawnEnvCacheForTests();
  });

  afterEach(async () => {
    spawnSyncSpy?.mockRestore();
    spawnSyncSpy = undefined;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    restoreEnv("AOP_HOME", originalAopHome);
    restoreEnv("AOP_REAL_GIT", originalAopRealGit);
    restoreEnv("AOP_DISABLE_LOGIN_SHELL_ENV", originalDisableLoginShellEnv);
    restoreEnv("HOME", originalHome);
    restoreEnv("PATH", originalPath);
    resetSpawnEnvCacheForTests();
  });

  test("merges login shell env below process env and explicit spawn env", () => {
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
      stdout: Buffer.from(
        [
          "SHELL_ONLY=from-shell",
          "PROCESS_ONLY=from-shell",
          "EXPLICIT_ONLY=from-shell",
          "PATH=/shell/bin",
          "",
        ].join("\0"),
      ),
    } as unknown as ReturnType<typeof Bun.spawnSync>);

    delete process.env.AOP_DISABLE_LOGIN_SHELL_ENV;
    const originalProcessOnly = process.env.PROCESS_ONLY;
    process.env.PROCESS_ONLY = "from-process";
    try {
      const env = buildSpawnEnv({ EXPLICIT_ONLY: "from-explicit", PATH: "/explicit/bin" });

      expect(env.SHELL_ONLY).toBe("from-shell");
      expect(env.PROCESS_ONLY).toBe("from-process");
      expect(env.EXPLICIT_ONLY).toBe("from-explicit");
      expect((env.PATH ?? "").split(delimiter)).toEqual(
        expect.arrayContaining(["/explicit/bin", "/shell/bin"]),
      );
    } finally {
      if (originalProcessOnly === undefined) {
        delete process.env.PROCESS_ONLY;
      } else {
        process.env.PROCESS_ONLY = originalProcessOnly;
      }
    }
  });

  test("does not leak the login-shell probe guard into built spawn envs", () => {
    // The probe injects AOP_DISABLE_LOGIN_SHELL_ENV=1 into the shell it spawns, so the
    // `/usr/bin/env -0` dump always echoes it back.
    spawnSyncSpy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
      stdout: Buffer.from(
        ["AOP_DISABLE_LOGIN_SHELL_ENV=1", "SHELL_ONLY=from-shell", ""].join("\0"),
      ),
    } as unknown as ReturnType<typeof Bun.spawnSync>);

    delete process.env.AOP_DISABLE_LOGIN_SHELL_ENV;
    const env = buildSpawnEnv();

    expect(env.SHELL_ONLY).toBe("from-shell");
    expect(env.AOP_DISABLE_LOGIN_SHELL_ENV).toBeUndefined();
  });

  test("hydrates a missing HOME for provider and git subprocesses", () => {
    process.env.AOP_DISABLE_LOGIN_SHELL_ENV = "1";
    process.env.HOME = "";

    const env = buildSpawnEnv({ HOME: "" });

    expect(env.HOME).toBe(homedir());
  });

  test("buildClaudeCodeSpawnEnv removes ANTHROPIC_API_KEY so subscription auth can win", () => {
    const env = buildClaudeCodeSpawnEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      AOP_TASK_ID: "task-1",
    });

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AOP_TASK_ID).toBe("task-1");
    expect(env.PATH).toBe(buildSpawnEnv({ AOP_TASK_ID: "task-1" }).PATH);
  });

  test("uses the configured git executable without installing AOP wrappers", async () => {
    const { aopHome } = await setupFakeGit();

    const env = buildSpawnEnv();

    expect(env.AOP_REAL_GIT).toBeUndefined();
    expect((env.PATH ?? "").split(delimiter)[0]).toBe(join(aopHome, "..", "real-bin"));
    expect(await Bun.file(join(aopHome, "guardrails", "bin", "git")).exists()).toBe(false);

    const proc = Bun.spawn({
      cmd: ["git", "push", "--force", "origin", "main"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await proc.exited).toBe(0);
    expect(await readStream(proc.stdout)).toBe("REAL:push --force origin main\n");
    expect(await readStream(proc.stderr)).toBe("");
  });

  test("removes inherited legacy AOP git wrappers from spawned environments", async () => {
    const { aopHome, realGit } = await setupFakeGit();
    const realBin = join(aopHome, "..", "real-bin");
    const env = buildSpawnEnv({
      AOP_REAL_GIT: realGit,
      PATH: [
        join(aopHome, "guardrails", "allow-push", "bin"),
        join(aopHome, "guardrails", "bin"),
        realBin,
      ].join(delimiter),
    });

    expect(env.AOP_REAL_GIT).toBeUndefined();
    expect((env.PATH ?? "").split(delimiter)).not.toContain(
      join(aopHome, "guardrails", "allow-push", "bin"),
    );
    expect((env.PATH ?? "").split(delimiter)).not.toContain(join(aopHome, "guardrails", "bin"));
    expect((env.PATH ?? "").split(delimiter)[0]).toBe(realBin);
  });
});

const setupFakeGit = async (): Promise<{ aopHome: string; realGit: string }> => {
  tempDir = await mkdtemp(join(tmpdir(), "aop-spawn-env-"));
  const aopHome = join(tempDir, "home");
  const binDir = join(tempDir, "real-bin");
  await mkdir(binDir, { recursive: true });

  const realGit = join(binDir, "git");
  await Bun.write(realGit, '#!/bin/sh\nprintf "REAL:%s\\n" "$*"\n');
  await chmod(realGit, 0o755);

  process.env.AOP_HOME = aopHome;
  delete process.env.AOP_REAL_GIT;
  process.env.AOP_DISABLE_LOGIN_SHELL_ENV = "1";
  process.env.PATH = binDir;
  resetSpawnEnvCacheForTests();

  return { aopHome, realGit };
};

const readStream = async (stream: unknown): Promise<string> => {
  if (!(stream instanceof ReadableStream)) {
    throw new Error("expected a ReadableStream");
  }
  return await new Response(stream).text();
};

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};
