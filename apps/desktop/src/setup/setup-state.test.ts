import { describe, expect, test } from "bun:test";
import {
  getRecommendedRuntimeAction,
  resolveSetupState,
  shouldEnterDashboard,
} from "./setup-state";
import type { SetupProbeState } from "./types";

const readyProbe = (): SetupProbeState => ({
  git: { id: "git", status: "ready", label: "Git", message: "Git is installed." },
  githubCli: {
    id: "github-cli",
    status: "ready",
    label: "GitHub CLI",
    message: "GitHub CLI is authenticated.",
  },
  runtimes: [
    {
      id: "claude",
      status: "ready",
      label: "Claude Code",
      message: "Claude Code is installed.",
      recommended: true,
    },
  ],
});

describe("desktop setup gate", () => {
  test("allows dashboard entry when Git, GitHub CLI, and one runtime are ready", () => {
    const state = resolveSetupState(readyProbe());

    expect(state.ready).toBe(true);
    expect(state.blockingRequirements).toEqual([]);
    expect(shouldEnterDashboard(state)).toBe(true);
  });

  test("blocks dashboard when Git is missing", () => {
    const probe = readyProbe();
    probe.git = { ...probe.git, status: "missing", message: "Git is missing." };

    const state = resolveSetupState(probe);

    expect(state.ready).toBe(false);
    expect(state.blockingRequirements).toContain("git");
    expect(shouldEnterDashboard(state)).toBe(false);
  });

  test("allows dashboard entry when optional GitHub CLI needs authentication", () => {
    const probe = readyProbe();
    probe.githubCli = {
      ...probe.githubCli,
      status: "needs-auth",
      message: "Run gh auth login.",
    };

    const state = resolveSetupState(probe);

    expect(state.ready).toBe(true);
    expect(state.blockingRequirements).toEqual([]);
    expect(shouldEnterDashboard(state)).toBe(true);
  });

  test("blocks dashboard when no runtime is ready", () => {
    const probe = readyProbe();
    probe.runtimes = probe.runtimes.map((runtime) => ({
      ...runtime,
      status: "missing",
      message: `${runtime.label} is missing.`,
    }));

    const state = resolveSetupState(probe);

    expect(state.ready).toBe(false);
    expect(state.blockingRequirements).toContain("runtime");
  });

  test("keeps setup blocked after the user declines required setup", () => {
    const state = resolveSetupState(readyProbe(), { declinedRequiredSetup: true });

    expect(state.ready).toBe(false);
    expect(state.blockingRequirements).toContain("user-consent");
    expect(shouldEnterDashboard(state)).toBe(false);
  });

  test("recommends Claude Code when no runtime is installed", () => {
    const probe = readyProbe();
    probe.runtimes = probe.runtimes.map((runtime) => ({
      ...runtime,
      status: "missing",
      message: `${runtime.label} is missing.`,
    }));

    const state = resolveSetupState(probe);

    expect(getRecommendedRuntimeAction(state)).toEqual({
      id: "install-runtime-claude",
      label: "Install Claude Code",
      requirementId: "runtime",
      requiresConsent: false,
      runtimeId: "claude",
    });
  });
});
