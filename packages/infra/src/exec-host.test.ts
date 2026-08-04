import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandExistsInvocation,
  NativeUnixHost,
  resolveExecHost,
  resolveUnixShell,
  shellInvocation,
} from "./exec-host.ts";

const readStream = async (stream: unknown): Promise<string> => {
  if (!(stream instanceof ReadableStream)) {
    throw new Error("expected a ReadableStream");
  }
  return await new Response(stream).text();
};

describe("resolveExecHost", () => {
  test("returns NativeUnixHost on darwin/linux when AOP_EXEC_HOST is unset", () => {
    expect(resolveExecHost("linux", undefined).kind).toBe("native-unix");
    expect(resolveExecHost("darwin", undefined).kind).toBe("native-unix");
  });

  test("treats wsl:<distro> on a unix host as native (Model B runs in-distro)", () => {
    expect(resolveExecHost("linux", "wsl:Ubuntu").kind).toBe("native-unix");
  });

  test("returns NativeWindowsHost for win32 + native", () => {
    expect(resolveExecHost("win32", undefined).kind).toBe("native-windows");
  });

  test("rejects WSL Model A on win32 as out of scope", () => {
    expect(() => resolveExecHost("win32", "wsl:Ubuntu")).toThrow(/Model A|out of scope/i);
  });
});

describe("platform invocations", () => {
  test("resolveUnixShell prefers zsh when present, else sh", () => {
    expect(
      resolveUnixShell(
        {},
        (path) => path === "/bin/zsh",
        () => null,
      ),
    ).toBe("/bin/zsh");
    expect(
      resolveUnixShell(
        { AOP_UNIX_SHELL: "/custom/zsh" },
        () => false,
        () => null,
      ),
    ).toBe("/custom/zsh");
    expect(
      resolveUnixShell(
        {},
        () => false,
        () => null,
      ),
    ).toBe("sh");
    expect(
      resolveUnixShell(
        { SHELL: "/bin/zsh" },
        (path) => path === "/bin/zsh",
        () => null,
      ),
    ).toBe("/bin/zsh");
  });

  test("shellInvocation uses zsh -lc on unix when available and cmd /c on windows", () => {
    expect(shellInvocation("native-unix", "bun test", "/bin/zsh")).toEqual([
      "/bin/zsh",
      "-lc",
      "bun test",
    ]);
    expect(shellInvocation("native-unix", "bun test", "sh")).toEqual(["sh", "-lc", "bun test"]);
    expect(shellInvocation("native-windows", "bun test")).toEqual(["cmd", "/c", "bun test"]);
  });

  test("commandExistsInvocation is injection-safe on unix and uses where on windows", () => {
    expect(commandExistsInvocation("native-unix", "git; rm -rf /", "/bin/zsh")).toEqual([
      "/bin/zsh",
      "-lc",
      'command -v "$0"',
      "git; rm -rf /",
    ]);
    expect(commandExistsInvocation("native-windows", "git")).toEqual(["where", "git"]);
  });
});

describe("NativeUnixHost", () => {
  const host = new NativeUnixHost();

  test("spawn pipes stdout", async () => {
    const proc = host.spawn({ cmd: ["echo", "hi"], stdout: "pipe", stderr: "ignore" });
    expect(await readStream(proc.stdout)).toBe("hi\n");
    expect(await proc.exited).toBe(0);
  });

  test("spawn passes env through to the child", async () => {
    const proc = host.spawn({
      cmd: ["sh", "-lc", 'printf %s "$EXEC_HOST_TEST"'],
      env: { ...process.env, EXEC_HOST_TEST: "from-env" } as Record<string, string>,
      stdout: "pipe",
      stderr: "ignore",
    });
    expect(await readStream(proc.stdout)).toBe("from-env");
  });

  test("spawn redirects stdout to a file", async () => {
    const file = join(tmpdir(), `exec-host-${process.pid}-${performance.now()}.log`);
    const proc = host.spawn({
      cmd: ["echo", "to-file"],
      stdout: { file },
      stderr: "ignore",
    });
    await proc.exited;
    expect((await Bun.file(file).text()).trim()).toBe("to-file");
  });

  test("detached + unref spawn still completes", async () => {
    const proc = host.spawn({
      cmd: ["true"],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
      unref: true,
    });
    expect(await proc.exited).toBe(0);
  });

  test("shell runs a script string", async () => {
    const proc = host.shell("echo shell-ran", { stdout: "pipe", stderr: "ignore" });
    expect(await readStream(proc.stdout)).toBe("shell-ran\n");
  });

  test("commandExists resolves real and missing commands", async () => {
    expect(await host.commandExists("sh")).toBe(true);
    expect(await host.commandExists("definitely-not-a-real-command-xyz")).toBe(false);
  });
});
