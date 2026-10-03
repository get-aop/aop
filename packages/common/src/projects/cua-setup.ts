import type { CuaCheck, CuaStatus } from "./computer-use.ts";

/**
 * How to set CUA Driver up on the AOP host, in one place: the dashboard's guide shows these steps,
 * and the host's own setup (`aop computer-use setup`, which the install script runs) does the same
 * work. AOP installs CUA Driver itself at the version it pins; the commands below are what the
 * person runs at the host when something is still missing. The driver's own commands come from
 * CUA's docs (https://cua.ai/docs/cua-driver) for 0.32.0.
 */
export const CUA_COMMANDS = {
  /** The host's setup, as the stable `aop` names it; a status carries its own host's command. */
  setup: "aop computer-use setup",
  start: "open -n -g -a CuaDriver --args serve",
  grant: "cua-driver permissions grant",
  permissionsStatus: "cua-driver permissions status",
  doctor: "cua-driver doctor",
} as const;

export interface CuaSetupCommand {
  label: string;
  command: string;
}

export interface CuaSetupStep {
  id: "packages" | "install" | "display" | "start" | "permissions" | "config";
  title: string;
  body: string;
  commands: CuaSetupCommand[];
  /** Where in the host's own settings to do it by hand, when there is such a place. */
  places: string[];
}

/**
 * The steps that take the host from `status` to ready, in order. Empty when it is ready and has
 * what it needs. Every command runs on the host, never on the device showing the guide.
 */
export const cuaSetupSteps = (status: CuaStatus): CuaSetupStep[] => {
  const macOS = status.host.platform === "darwin";
  const setup = status.fix.command ?? CUA_COMMANDS.setup;
  const steps: CuaSetupStep[] = [];
  if (status.fix.sudoCommand) steps.push(packagesStep(status, status.fix.sudoCommand));
  if (needsDriver(status)) steps.push(installStep(status, setup));
  if (status.reason === "no-display") steps.push(displayStep(setup));
  if (macOS && (status.status === "not-installed" || status.reason === "not-running")) {
    steps.push(startStep);
  }
  if (macOS && status.status !== "ready") steps.push(permissionsStep(missingGrants(status)));
  if (status.status !== "ready") steps.push(configStep);
  return steps;
};

const needsDriver = (status: CuaStatus): boolean =>
  status.status === "not-installed" ||
  status.reason === "no-answer" ||
  status.checks.some((check) => check.id === "up-to-date" && check.ok === false);

const missingGrants = (status: CuaStatus): CuaCheck[] =>
  status.checks.filter(
    (check) =>
      (check.id === "accessibility" || check.id === "screen-recording") && check.ok !== true,
  );

const packagesStep = (status: CuaStatus, sudoCommand: string): CuaSetupStep => ({
  id: "packages",
  title: "Install the system packages",
  body: `Computer use on this host needs ${listOf(status.fix.missing)}. Installing them needs root, so AOP cannot do it by itself: run this one command at the host (it asks for your password).`,
  commands: [{ label: "Install with sudo", command: sudoCommand }],
  places: [],
});

const installStep = (status: CuaStatus, setup: string): CuaSetupStep => {
  const pinned = status.fix.pinnedVersion;
  const title =
    status.status === "not-installed"
      ? "Install CUA Driver"
      : status.reason === "no-answer"
        ? "Repair CUA Driver"
        : `Update CUA Driver to ${pinned}`;
  return {
    id: "install",
    title,
    body: `AOP installs CUA Driver ${pinned} for you, in your home folder (no sudo).${status.reason === "no-answer" ? " The driver there did not answer; `cua-driver doctor` says what is wrong." : ""}`,
    commands: [
      { label: "Set up", command: setup },
      ...(status.reason === "no-answer"
        ? [{ label: "Diagnose", command: CUA_COMMANDS.doctor }]
        : []),
    ],
    places: [],
  };
};

const displayStep = (setup: string): CuaSetupStep => ({
  id: "display",
  title: "Set up the screen",
  body: "No X display is up for CUA Driver to drive. Setup makes a virtual one (Xvfb with a window manager, started at boot), or uses your desktop if you choose it.",
  commands: [{ label: "Set up", command: setup }],
  places: [],
});

const startStep: CuaSetupStep = {
  id: "start",
  title: "Start CUA Driver",
  body: "Its app runs in the background and holds the macOS permissions; the AOP host reaches it through `cua-driver mcp`.",
  commands: [{ label: "Start", command: CUA_COMMANDS.start }],
  places: [],
};

const permissionsStep = (missing: CuaCheck[]): CuaSetupStep => {
  const names = missing.length > 0 ? missing.map((check) => check.label) : GRANT_NAMES;
  return {
    id: "permissions",
    title: "Grant the macOS permissions",
    body: `CUA Driver needs ${names.join(" and ")}, granted to the Cua Driver app (not to your terminal). The grant command opens the dialogs and verifies capture; on macOS Tahoe it also asks for direct capture consent. Someone has to click Allow at the host's screen; AOP never asks from a thread.`,
    commands: [
      { label: "Grant", command: CUA_COMMANDS.grant },
      { label: "Check", command: CUA_COMMANDS.permissionsStatus },
    ],
    places: names.map((name) => `System Settings › Privacy & Security › ${PANES[name] ?? name}`),
  };
};

const GRANT_NAMES = ["Accessibility", "Screen Recording"];

// Recent macOS names the Screen Recording pane "Screen & System Audio Recording".
const PANES: Record<string, string> = {
  Accessibility: "Accessibility: turn on Cua Driver",
  "Screen Recording": "Screen & System Audio Recording: turn on Cua Driver",
};

const configStep: CuaSetupStep = {
  id: "config",
  title: "Nothing else to configure",
  body: "CUA Driver needs no API key, and the AOP host hands its tools to this project's threads itself, one thread at a time: nothing goes in your Claude Code config. Threads use the tools only with Thread access set to Full access.",
  commands: [],
  places: [],
};

const listOf = (items: string[]): string => {
  if (items.length <= 1) return items[0] ?? "a few system packages";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
};
