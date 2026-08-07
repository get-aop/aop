import { describe, expect, test } from "bun:test";
import { runSetupActionWithRunner } from "./commands";
import type { CommandOutput, CommandRunner, CommandSpec } from "./types";

describe("Electron setup commands", () => {
  test("rejects unknown setup actions", async () => {
    const runner = readyRunner();

    await expect(
      runSetupActionWithRunner("install-everything", runner, "unix", {
        homebrew: true,
        winget: false,
      }),
    ).rejects.toThrow("Unknown setup action.");
  });

  test("executes a known command and then checks setup again", async () => {
    const runner = readyRunner({
      "open https://cli.github.com/": success("opened"),
    });

    const state = await runSetupActionWithRunner("install-github-cli", runner, "unix", {
      homebrew: true,
      winget: false,
    });

    expect(state.ready).toBe(true);
    expect(runner.calls).toContain("open https://cli.github.com/");
    expect(runner.calls).toContain("gh auth status -h github.com");
  });

  test("surfaces setup command failures", async () => {
    const runner = readyRunner({
      "open https://cli.github.com/": { status: 1, stdout: "", stderr: "open failed" },
    });

    await expect(
      runSetupActionWithRunner("install-github-cli", runner, "unix", {
        homebrew: true,
        winget: false,
      }),
    ).rejects.toThrow("open failed");
  });
});

interface RecordingRunner extends CommandRunner {
  calls: string[];
}

const readyRunner = (extra: Record<string, CommandOutput> = {}): RecordingRunner => {
  const calls: string[] = [];
  const outputs: Record<string, CommandOutput> = {
    "git --version": success("git version 2.45.0"),
    "gh --version": success("gh version 2.49.0"),
    "gh auth status -h github.com": success("Logged in"),
    "codex --version": success("codex 1.2.3"),
    ...extra,
  };
  return {
    calls,
    run: async (command: CommandSpec) => {
      const key = [command.program, ...command.args].join(" ");
      calls.push(key);
      return outputs[key] ?? { status: 127, stdout: "", stderr: "command not found" };
    },
  };
};

const success = (stdout: string): CommandOutput => ({ status: 0, stdout, stderr: "" });
