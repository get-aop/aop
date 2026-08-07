import { describe, expect, test } from "bun:test";
import { collectSetupState, missingWslSetupState } from "./setup";
import type { CommandOutput, CommandRunner, CommandSpec } from "./types";

describe("Electron desktop setup detection", () => {
  test("marks missing WSL as blocking", () => {
    const state = missingWslSetupState();

    expect(state.ready).toBe(false);
    expect(state.blockingRequirements).toEqual(["wsl"]);
    expect(state.requirements[0]).toMatchObject({
      id: "wsl",
      status: "missing",
      message: expect.stringContaining("WSL 2"),
    });
  });

  test("is ready with Git and one supported runtime", async () => {
    const runner = createRunner({
      "git --version": success("git version 2.45.0"),
      "gh --version": success("gh version 2.49.0"),
      "gh auth status -h github.com": success("Logged in"),
      "codex --version": success("codex 1.2.3"),
    });

    const state = await collectSetupState(runner, "unix");

    expect(state.ready).toBe(true);
    expect(state.blockingRequirements).toEqual([]);
    expect(state.requirements.map((requirement) => requirement.status)).toEqual([
      "ready",
      "ready",
      "ready",
    ]);
    expect(state.automationActions?.map((action) => action.id)).toContain(
      "install-browser-runtime",
    );
    expect(state.automationActions?.map((action) => action.id)).toContain(
      "install-codex-browser-plugins",
    );
  });

  test("keeps GitHub authentication optional", async () => {
    const runner = createRunner({
      "git --version": success("git version 2.45.0"),
      "gh --version": success("gh version 2.49.0"),
      "codex --version": success("codex 1.2.3"),
    });

    const state = await collectSetupState(runner, "unix");

    expect(state.ready).toBe(true);
    expect(state.requirements[1]?.status).toBe("needs-auth");
    expect(state.blockingRequirements).toEqual([]);
  });

  test("recommends Codex and exposes every runtime guide when none is installed", async () => {
    const runner = createRunner({
      "git --version": success("git version 2.45.0"),
      "gh --version": success("gh version 2.49.0"),
      "gh auth status -h github.com": success("Logged in"),
    });

    const state = await collectSetupState(runner, "unix");

    expect(state.ready).toBe(false);
    expect(state.blockingRequirements).toEqual(["runtime"]);
    expect(state.runtimes[0]).toMatchObject({ id: "codex", recommended: true });
    expect(state.runtimes[3]?.id).toBe("pi");
    expect(state.requirements[2]?.actions?.map((action) => action.id)).toEqual([
      "install-runtime-codex",
      "install-runtime-claude",
      "install-runtime-opencode",
      "install-runtime-pi",
    ]);
    expect(state.requirements[2]?.actions?.[0]).toMatchObject({
      requiresConsent: false,
      commandPreview: expect.stringContaining("codex/cli"),
    });
  });
});

const success = (stdout: string): CommandOutput => ({ status: 0, stdout, stderr: "" });

const createRunner = (outputs: Record<string, CommandOutput>): CommandRunner => ({
  run: async (command: CommandSpec) =>
    outputs[[command.program, ...command.args].join(" ")] ?? {
      status: 127,
      stdout: "",
      stderr: "command not found",
    },
});
