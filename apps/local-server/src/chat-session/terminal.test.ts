import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTerminalCommand } from "./terminal.ts";

describe("runTerminalCommand", () => {
  test("lists files in the session cwd", async () => {
    const cwd = join(tmpdir(), `aop-term-${crypto.randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, "hello.txt"), "hi");

    const lines = await runTerminalCommand({
      sessionId: "s1",
      cwd,
      command: "ls",
      publish: false,
    });

    expect(lines.some((l) => l.tone === "cmd" && l.text.includes("ls"))).toBe(true);
    expect(lines.some((l) => l.text.includes("hello.txt"))).toBe(true);
    expect(lines.some((l) => l.tone === "meta" && l.text.includes("exit"))).toBe(true);
  });

  test("reports non-zero exit for failing commands", async () => {
    const cwd = join(tmpdir(), `aop-term-fail-${crypto.randomUUID()}`);
    await mkdir(cwd, { recursive: true });

    const lines = await runTerminalCommand({
      sessionId: "s1",
      cwd,
      command: "false",
      publish: false,
    });

    expect(lines.some((l) => l.text.includes("exit 1"))).toBe(true);
  });

  test("handles clear is client-side only — empty command returns nothing", async () => {
    const lines = await runTerminalCommand({
      sessionId: "s1",
      cwd: tmpdir(),
      command: "   ",
      publish: false,
    });
    expect(lines).toEqual([]);
  });

  test("streams stdout line-by-line as it arrives", async () => {
    const cwd = join(tmpdir(), `aop-term-stream-${crypto.randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    const seen: string[] = [];
    const { subscribeChatSession } = await import("./session-events.ts");
    const unsub = subscribeChatSession("s-stream", (event) => {
      if (event.type === "terminal-line") seen.push(event.text);
    });

    const lines = await runTerminalCommand({
      sessionId: "s-stream",
      cwd,
      command: "printf 'one\\ntwo\\n'",
      publish: true,
    });
    unsub();

    expect(lines.some((l) => l.text === "one")).toBe(true);
    expect(lines.some((l) => l.text === "two")).toBe(true);
    expect(seen).toContain("one");
    expect(seen).toContain("two");
  });

  test("kills hung commands by timeout with a meta message", async () => {
    const cwd = join(tmpdir(), `aop-term-timeout-${crypto.randomUUID()}`);
    await mkdir(cwd, { recursive: true });

    const lines = await runTerminalCommand({
      sessionId: "s-timeout",
      cwd,
      command: "sleep 5",
      timeoutMs: 200,
      publish: false,
    });

    expect(lines.some((l) => l.tone === "meta" && l.text.includes("timeout"))).toBe(true);
  });

  test("includes stderr output as out lines", async () => {
    const cwd = join(tmpdir(), `aop-term-err-${crypto.randomUUID()}`);
    await mkdir(cwd, { recursive: true });

    const lines = await runTerminalCommand({
      sessionId: "s-err",
      cwd,
      command: "echo err-msg 1>&2",
      publish: false,
    });

    expect(lines.some((l) => l.text.includes("err-msg"))).toBe(true);
  });
});
