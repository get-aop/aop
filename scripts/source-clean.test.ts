import { afterEach, describe, expect, mock, test } from "bun:test";
import { chmod as chmodFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CleanSummary, cleanFromSource, parseCleanerArgs } from "./source-clean";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseCleanerArgs", () => {
  test("recognizes help flags without side effects", () => {
    expect(parseCleanerArgs(["--help"])).toEqual({
      dryRun: false,
      mode: "help",
      yes: false,
    });
    expect(parseCleanerArgs(["-h"])).toEqual({
      dryRun: false,
      mode: "help",
      yes: false,
    });
  });

  test("recognizes confirmation, dry-run, and custom AOP home", () => {
    expect(parseCleanerArgs(["--yes", "--dry-run", "--aop-home", "/tmp/aop-test"])).toEqual({
      aopHome: "/tmp/aop-test",
      dryRun: true,
      mode: "clean",
      yes: true,
    });
  });

  test("rejects unknown flags", () => {
    expect(() => parseCleanerArgs(["--wat"])).toThrow('Unknown argument "--wat"');
  });
});

describe("clean shell", () => {
  test("falls back to npx when bun is not on PATH", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "aop-clean-shell-"));
    tempDirs.push(tempDir);
    const fakeBinDir = join(tempDir, "bin");
    const argsPath = join(tempDir, "npx-args.txt");
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(
      join(fakeBinDir, "npx"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsPath)}\n`,
    );
    await chmodFile(join(fakeBinDir, "npx"), 0o755);

    const proc = Bun.spawn({
      cmd: ["./clean", "--help"],
      env: { ...process.env, PATH: `${fakeBinDir}:/usr/bin:/bin` },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await proc.exited).toBe(0);
    expect(await readFile(argsPath, "utf8")).toBe(
      ["--yes", "bun", join(process.cwd(), "scripts", "source-clean.ts"), "--help", ""].join("\n"),
    );
  });
});

describe("cleanFromSource", () => {
  test("dry-run reports the target without uninstalling or deleting", async () => {
    const calls: string[] = [];
    const summary = await cleanFromSource({
      aopHome: "/tmp/aop-home-clean",
      dryRun: true,
      homeDir: "/home/marcelo",
      platform: "linux",
      workspaceDir: "/repo",
      dependencies: {
        removeDir: mock(async (path: string) => {
          calls.push(`remove:${path}`);
        }),
        uninstall: mock(async () => {
          calls.push("uninstall");
        }),
      },
    });

    expect(summary).toEqual({
      aopHome: "/tmp/aop-home-clean",
      dryRun: true,
      removed: false,
    } satisfies CleanSummary);
    expect(calls).toEqual([]);
  });

  test("uninstalls source setup and removes the configured AOP home when confirmed", async () => {
    const calls: string[] = [];

    const summary = await cleanFromSource({
      aopHome: "/home/marcelo/.aop",
      confirm: true,
      homeDir: "/home/marcelo",
      platform: "linux",
      workspaceDir: "/repo",
      dependencies: {
        removeDir: mock(async (path: string) => {
          calls.push(`remove:${path}`);
        }),
        uninstall: mock(async (options) => {
          calls.push(`uninstall:${options.homeDir}:${options.workspaceDir}`);
        }),
      },
    });

    expect(summary).toEqual({
      aopHome: "/home/marcelo/.aop",
      dryRun: false,
      removed: true,
    } satisfies CleanSummary);
    expect(calls).toEqual(["uninstall:/home/marcelo:/repo", "remove:/home/marcelo/.aop"]);
  });

  test("uses confirmation dependency when --yes is not supplied", async () => {
    const calls: string[] = [];

    await expect(
      cleanFromSource({
        aopHome: "/home/marcelo/.aop",
        homeDir: "/home/marcelo",
        platform: "linux",
        workspaceDir: "/repo",
        dependencies: {
          confirm: mock(async () => false),
          removeDir: mock(async (path: string) => {
            calls.push(`remove:${path}`);
          }),
          uninstall: mock(async () => {
            calls.push("uninstall");
          }),
        },
      }),
    ).rejects.toThrow("AOP clean cancelled.");

    expect(calls).toEqual([]);
  });

  test("refuses dangerous targets", async () => {
    const removeDir = mock(async () => undefined);

    await expect(
      cleanFromSource({
        aopHome: "/home/marcelo",
        confirm: true,
        homeDir: "/home/marcelo",
        platform: "linux",
        workspaceDir: "/repo",
        dependencies: { removeDir },
      }),
    ).rejects.toThrow("Refusing to clean the user home directory");

    await expect(
      cleanFromSource({
        aopHome: "/",
        confirm: true,
        homeDir: "/home/marcelo",
        platform: "linux",
        workspaceDir: "/repo",
        dependencies: { removeDir },
      }),
    ).rejects.toThrow("Refusing to clean filesystem root");

    await expect(
      cleanFromSource({
        aopHome: "/repo",
        confirm: true,
        homeDir: "/home/marcelo",
        platform: "linux",
        workspaceDir: "/repo",
        dependencies: { removeDir },
      }),
    ).rejects.toThrow("Refusing to clean the AOP source workspace");

    expect(removeDir).not.toHaveBeenCalled();
  });
});
