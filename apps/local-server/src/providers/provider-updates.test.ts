import { describe, expect, test } from "bun:test";
import { createProviderUpdateService, resolveProviderUpdateCommand } from "./provider-updates.ts";

describe("provider CLI updates", () => {
  test("uses the installer that owns the resolved CLI", () => {
    expect(
      resolveProviderUpdateCommand(
        "claude-code",
        "/Users/test/.local/bin/claude",
        "/Users/test/.local/share/claude/versions/2.1.220",
      ),
    ).toEqual(["/Users/test/.local/bin/claude", "update"]);
    expect(
      resolveProviderUpdateCommand(
        "claude-code",
        "/Users/test/.bun/bin/claude",
        "/Users/test/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js",
      ),
    ).toEqual(["bun", "install", "-g", "@anthropic-ai/claude-code@latest"]);
    expect(
      resolveProviderUpdateCommand(
        "claude-code",
        "/opt/homebrew/bin/claude",
        "/opt/homebrew/Cellar/claude-code/2.1.220/bin/claude",
      ),
    ).toEqual(["brew", "upgrade", "claude-code"]);
  });

  test("updates the installed CLI in one background job and tracks only claude-code", async () => {
    const commands: string[][] = [];
    const service = createProviderUpdateService({
      which: (command) => `/bin/${command}`,
      realpath: async (path) => path,
      run: async (command) => {
        commands.push(command);
        return { exitCode: 0, stdout: "updated", stderr: "" };
      },
    });

    expect(await service.startAll()).toEqual({ accepted: true });
    await service.waitForIdle();

    expect(commands).toEqual([["/bin/claude", "update"]]);
    expect(Object.keys(service.getStates())).toEqual(["claude-code"]);
    expect(service.getStates()["claude-code"]).toMatchObject({ status: "succeeded" });
  });

  test("skips the update when the CLI is not installed", async () => {
    const commands: string[][] = [];
    const service = createProviderUpdateService({
      which: () => null,
      realpath: async (path) => path,
      run: async (command) => {
        commands.push(command);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await service.startAll();
    await service.waitForIdle();

    expect(commands).toEqual([]);
    expect(service.getStates()["claude-code"]).toMatchObject({ status: "skipped" });
  });

  test("keeps terminal state available after the browser reconnects", async () => {
    const service = createProviderUpdateService({
      which: (command) => (command === "claude" ? "/bin/claude" : null),
      realpath: async (path) => path,
      run: async () => ({ exitCode: 1, stdout: "", stderr: "permission denied" }),
    });

    await service.startAll();
    await service.waitForIdle();

    expect(service.getStates()["claude-code"]).toMatchObject({
      status: "failed",
      message: "permission denied",
    });
    expect(service.getStates()["claude-code"].finishedAt).not.toBeNull();
  });

  test("rejects a second update request while commands are being resolved", async () => {
    let releaseRealpath: (() => void) | undefined;
    const realpathReady = new Promise<void>((resolve) => {
      releaseRealpath = resolve;
    });
    const service = createProviderUpdateService({
      which: (command) => (command === "claude" ? "/bin/claude" : null),
      realpath: async (path) => {
        await realpathReady;
        return path;
      },
      run: async () => ({ exitCode: 0, stdout: "updated", stderr: "" }),
    });

    const first = service.startAll();
    expect(await service.startAll()).toEqual({ accepted: false });
    releaseRealpath?.();
    expect(await first).toEqual({ accepted: true });
    await service.waitForIdle();
  });
});
