import { describe, expect, test } from "bun:test";
import { createProviderUpdateService, resolveProviderUpdateCommand } from "./provider-updates.ts";

describe("provider CLI updates", () => {
  test("uses the installer that owns each resolved CLI", () => {
    expect(
      resolveProviderUpdateCommand(
        "claude-code",
        "/Users/test/.local/bin/claude",
        "/Users/test/.local/share/claude/versions/2.1.220",
      ),
    ).toEqual(["/Users/test/.local/bin/claude", "update"]);
    expect(
      resolveProviderUpdateCommand(
        "opencode",
        "/Users/test/.opencode/bin/opencode",
        "/Users/test/.opencode/bin/opencode",
      ),
    ).toEqual(["/Users/test/.opencode/bin/opencode", "upgrade"]);
    expect(
      resolveProviderUpdateCommand(
        "codex-cli",
        "/opt/homebrew/bin/codex",
        "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js",
      ),
    ).toEqual(["npm", "install", "-g", "@openai/codex@latest"]);
    expect(
      resolveProviderUpdateCommand(
        "claude-code",
        "/opt/homebrew/bin/claude",
        "/opt/homebrew/Cellar/claude-code/2.1.220/bin/claude",
      ),
    ).toEqual(["brew", "upgrade", "claude-code"]);
  });

  test("updates every installed supported CLI in one background job", async () => {
    const commands: string[][] = [];
    const service = createProviderUpdateService({
      which: (command) => (command === "pi" ? null : `/bin/${command}`),
      realpath: async (path) =>
        path === "/bin/codex" ? "/usr/local/lib/node_modules/@openai/codex/bin/codex.js" : path,
      run: async (command) => {
        commands.push(command);
        return { exitCode: 0, stdout: "updated", stderr: "" };
      },
    });

    expect(await service.startAll()).toEqual({ accepted: true });
    await service.waitForIdle();

    expect(commands).toEqual([
      ["/bin/claude", "update"],
      ["npm", "install", "-g", "@openai/codex@latest"],
      ["/bin/grok", "update"],
      ["/bin/opencode", "upgrade"],
    ]);
    expect(service.getStates()).toMatchObject({
      "claude-code": { status: "succeeded" },
      "codex-cli": { status: "succeeded" },
      "grok-build": { status: "succeeded" },
      opencode: { status: "succeeded" },
      pi: { status: "skipped" },
    });
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
