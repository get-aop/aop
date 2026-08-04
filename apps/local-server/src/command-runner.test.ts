import { describe, expect, test } from "bun:test";
import {
  CommandCancelledError,
  CommandTimeoutError,
  createDefaultRunner,
  type RunCommand,
} from "./command-runner.ts";

const runShell = createDefaultRunner("/bin/sh");

describe("createDefaultRunner", () => {
  test("captures output, exit code, and environment overrides", async () => {
    const result = await runShell(
      ["-c", 'printf "%s" "$AOP_RUNNER_TEST"; printf "problem" >&2; exit 7'],
      process.cwd(),
      { env: { AOP_RUNNER_TEST: "ready" } },
    );

    expect(result).toEqual({ exitCode: 7, stdout: "ready", stderr: "problem" });
  });

  test("times out a blocked command", async () => {
    await expect(
      runShell(["-c", "sleep 1"], process.cwd(), { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(CommandTimeoutError);
  });

  test("cancels a running command", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await expect(
      runShell(["-c", "sleep 1"], process.cwd(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(CommandCancelledError);
  });

  test("keeps two-argument fakes compatible", async () => {
    const fake: RunCommand = async (args, cwd) => ({
      exitCode: 0,
      stdout: `${cwd}:${args.join(" ")}`,
      stderr: "",
    });

    expect(await fake(["status"], "/repo")).toEqual({
      exitCode: 0,
      stdout: "/repo:status",
      stderr: "",
    });
  });
});
