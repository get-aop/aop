import { describe, expect, test } from "bun:test";
import { CLAUDE_CODE_CLI } from "./definitions.ts";
import { detectUpdatePlan, formatCommand } from "./install-method.ts";

const HOME = "/Users/me";
const none = () => false;

const detect = (path: string, realPath: string, exists: (path: string) => boolean = none) =>
  detectUpdatePlan(CLAUDE_CODE_CLI, { path, realPath }, "latest", exists);

describe("detectUpdatePlan for Claude Code", () => {
  test("the native installer updates itself, and is safe while runs are in flight", () => {
    const plan = detect(
      `${HOME}/.local/bin/claude`,
      `${HOME}/.local/share/claude/versions/2.1.286`,
    );
    expect(plan).toEqual({
      method: "native",
      command: [`${HOME}/.local/bin/claude`, "update"],
      manualCommand: "claude update",
      safeWhileRunning: true,
    });
  });

  test("the older local install also updates with `claude update`, but not under running runs", () => {
    const plan = detect(
      `${HOME}/.claude/local/claude`,
      `${HOME}/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js`,
    );
    expect(plan.method).toBe("native");
    expect(plan.command).toEqual([`${HOME}/.claude/local/claude`, "update"]);
    expect(plan.safeWhileRunning).toBe(false);
  });

  test("an npm global install uses the npm beside it (nvm), or npm on PATH", () => {
    const bin = `${HOME}/.nvm/versions/node/v22.1.0/bin`;
    const real = `${HOME}/.nvm/versions/node/v22.1.0/lib/node_modules/@anthropic-ai/claude-code/cli.js`;
    const beside = detect(`${bin}/claude`, real, (path) => path === `${bin}/npm`);
    expect(beside.method).toBe("npm");
    expect(beside.command).toEqual([
      `${bin}/npm`,
      "install",
      "--global",
      "@anthropic-ai/claude-code@latest",
    ]);
    expect(beside.manualCommand).toBe("npm install --global @anthropic-ai/claude-code@latest");
    expect(beside.safeWhileRunning).toBe(false);

    const bare = detect(
      "/usr/local/bin/claude",
      "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
    );
    expect(bare.command?.[0]).toBe("npm");
  });

  test("a bun global install is updated with bun add --global", () => {
    const plan = detect(
      `${HOME}/.bun/bin/claude`,
      `${HOME}/.bun/install/global/node_modules/@anthropic-ai/claude-code/cli.js`,
      (path) => path === `${HOME}/.bun/bin/bun`,
    );
    expect(plan.method).toBe("bun");
    expect(plan.command).toEqual([
      `${HOME}/.bun/bin/bun`,
      "add",
      "--global",
      "@anthropic-ai/claude-code@latest",
    ]);
  });

  test("a pnpm global install is updated with pnpm add --global", () => {
    const plan = detect(
      `${HOME}/Library/pnpm/claude`,
      `${HOME}/Library/pnpm/global/5/.pnpm/@anthropic-ai+claude-code@2.1.0/node_modules/@anthropic-ai/claude-code/cli.js`,
    );
    expect(plan.method).toBe("pnpm");
    expect(plan.command).toEqual(["pnpm", "add", "--global", "@anthropic-ai/claude-code@latest"]);
  });

  test("a Homebrew cask or formula is upgraded with the brew beside it", () => {
    const cask = detect(
      "/opt/homebrew/bin/claude",
      "/opt/homebrew/Caskroom/claude-code/2.1.286/claude",
      (path) => path === "/opt/homebrew/bin/brew",
    );
    expect(cask.method).toBe("brew");
    expect(cask.command).toEqual(["/opt/homebrew/bin/brew", "upgrade", "--cask", "claude-code"]);
    expect(cask.manualCommand).toBe("brew upgrade --cask claude-code");
    expect(cask.safeWhileRunning).toBe(false);

    const formula = detect(
      "/usr/local/bin/claude",
      "/usr/local/Cellar/claude-code/2.1.286/bin/claude",
    );
    expect(formula.command).toEqual(["brew", "upgrade", "claude-code"]);
  });

  test("anything else is unknown: no command, and the ways to update it by hand", () => {
    const plan = detect("/opt/tools/claude", "/opt/tools/claude");
    expect(plan).toEqual({
      method: "unknown",
      command: null,
      manualCommand: "claude update, or npm install --global @anthropic-ai/claude-code@latest",
      safeWhileRunning: false,
    });
  });

  test("the stable channel installs the stable dist-tag", () => {
    const plan = detectUpdatePlan(
      CLAUDE_CODE_CLI,
      {
        path: "/usr/local/bin/claude",
        realPath: "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js",
      },
      "stable",
      none,
    );
    expect(plan.command?.at(-1)).toBe("@anthropic-ai/claude-code@stable");
  });

  test("no plan ever runs sudo", () => {
    const paths = [
      ["/a/claude", `${HOME}/.local/share/claude/versions/1.0.0`],
      ["/a/claude", "/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js"],
      ["/a/claude", "/opt/homebrew/Caskroom/claude-code/1/claude"],
    ] as const;
    for (const [path, real] of paths) {
      expect(detect(path, real).command?.join(" ")).not.toContain("sudo");
    }
  });
});

describe("formatCommand", () => {
  test("shows the program by name and quotes arguments that need it", () => {
    expect(formatCommand(["/opt/homebrew/bin/brew", "upgrade", "--cask", "claude-code"])).toBe(
      "brew upgrade --cask claude-code",
    );
    expect(formatCommand(["npm", "install", "a b"])).toBe("npm install 'a b'");
  });
});
