import { describe, expect, test } from "bun:test";
import { CHANNELS, type RuntimeStatus } from "@aop/common";
import { claudeCheck } from "./claude-check.ts";
import { githubCheck } from "./github-check.ts";
import { HOST, NIGHTLY } from "./test-utils.ts";
import { updatesCheck } from "./updates-check.ts";

const runtime = (overrides: Partial<RuntimeStatus> = {}): RuntimeStatus => ({
  runtimeId: "claude-code",
  path: "/home/ada/.local/bin/claude",
  version: "2.1.288",
  auth: "logged-in",
  ready: true,
  reason: null,
  checkedAt: "2026-10-03T09:00:00.000Z",
  ...overrides,
});

const RUNTIMES = { kind: "link", label: "Runtimes", target: "runtimes" } as const;

describe("claudeCheck", () => {
  test("ready: the version, the login and whether it is the default runtime", () => {
    expect(claudeCheck({ status: runtime(), isDefault: true }, HOST)).toEqual({
      id: "claude",
      state: "ok",
      title: "Claude Code ready",
      detail: "2.1.288, logged in · default runtime",
      actions: [RUNTIMES],
    });
    expect(
      claudeCheck({ status: runtime({ auth: "unknown" }), isDefault: false }, HOST).detail,
    ).toBe("2.1.288");
  });

  test("logged out: tells the person to log in on the host", () => {
    const check = claudeCheck(
      { status: runtime({ auth: "logged-out", ready: false }), isDefault: true },
      HOST,
    );

    expect(check).toMatchObject({
      state: "error",
      title: "Claude Code",
      detail: "Not logged in. Run claude on soulf and use /login.",
    });
    expect(check.actions[0]).toEqual({
      kind: "how-to",
      steps: ["On soulf, run claude in a terminal and use /login."],
      command: "claude",
    });
  });

  test("not installed, or no built-in runtime at all: how to install it", () => {
    const missing = claudeCheck(
      { status: runtime({ path: null, ready: false }), isDefault: true },
      HOST,
    );

    expect(missing).toMatchObject({ state: "error", detail: "Not installed on soulf." });
    expect(missing.actions[0]).toMatchObject({
      kind: "how-to",
      command: "curl -fsSL https://claude.ai/install.sh | bash",
    });
    expect(claudeCheck(null, HOST)).toEqual(missing);
  });
});

describe("githubCheck", () => {
  test("names the login gh is signed in as", () => {
    expect(githubCheck({ authenticated: true, login: "marcelormendes" }, HOST)).toEqual({
      id: "github",
      state: "ok",
      title: "GitHub",
      detail: "gh signed in as marcelormendes",
      actions: [],
    });
  });

  test("signed out or missing is an error with gh auth login", () => {
    const signedOut = githubCheck(
      { authenticated: false, reason: "signed-out", message: "run gh auth login" },
      HOST,
    );
    const missing = githubCheck(
      { authenticated: false, reason: "gh-missing", message: "ENOENT" },
      HOST,
    );

    expect(signedOut).toEqual({
      id: "github",
      state: "error",
      title: "GitHub",
      detail: "gh isn't signed in.",
      actions: [
        { kind: "how-to", steps: ["On soulf, sign in to GitHub:"], command: "gh auth login" },
      ],
    });
    expect(missing).toMatchObject({ state: "error", detail: "gh isn't installed." });
  });

  test("an unreachable GitHub is a warning with what gh said", () => {
    const check = githubCheck(
      { authenticated: false, reason: "unreachable", message: "dial tcp: timeout\nmore" },
      HOST,
    );

    expect(check).toMatchObject({
      state: "warning",
      detail: "gh couldn't reach GitHub: dial tcp: timeout",
    });
    expect(check.actions[0]).toMatchObject({ command: "gh auth status" });
  });
});

describe("updatesCheck", () => {
  const look = { checking: true, mode: "idle", window: null, block: null } as const;

  test("names the channel and when it installs, and links AOP settings › Updates", () => {
    expect(updatesCheck(look, NIGHTLY)).toEqual({
      id: "updates",
      state: "ok",
      title: "Updates",
      detail: "Nightly, installs automatically when idle",
      actions: [{ kind: "link", label: "Updates", target: "updates" }],
    });
    expect(updatesCheck({ ...look, mode: "ask" }, CHANNELS.stable).detail).toBe(
      "Stable, asks before installing",
    );
    expect(updatesCheck({ ...look, mode: "window", window: "01:00-06:00" }, NIGHTLY).detail).toBe(
      "Nightly, installs automatically between 01:00 and 06:00 when idle",
    );
  });

  test("says when it does not check, runs from source or comes with the app", () => {
    expect(updatesCheck({ ...look, checking: false }, NIGHTLY).detail).toBe(
      "Nightly, doesn't check for updates",
    );
    expect(updatesCheck({ ...look, block: "source" }, NIGHTLY).detail).toBe(
      "Runs from source: pull and rebuild",
    );
    expect(updatesCheck({ ...look, block: "app" }, NIGHTLY).detail).toBe(
      "Updates with the AOP Nightly app",
    );
  });
});
