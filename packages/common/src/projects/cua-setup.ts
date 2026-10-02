import type { CuaCheck, CuaStatus } from "./computer-use.ts";

/**
 * How to set CUA Driver up on the AOP host, in one place: the dashboard's guide shows these steps
 * today, and a host-side setup flow can run the same commands later. Commands come from CUA's
 * docs (https://cua.ai/docs/cua-driver) and the installer's own output for 0.32.0.
 */
export const CUA_COMMANDS = {
  install: '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"',
  update: "cua-driver update --apply",
  checkUpdate: "cua-driver check-update",
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
  id: "install" | "update" | "start" | "permissions" | "config";
  title: string;
  body: string;
  commands: CuaSetupCommand[];
  /** Where in the host's own settings to do it by hand, when there is such a place. */
  places: string[];
}

/**
 * The steps that take the host from `status` to ready, in order. Empty when it is ready and up to
 * date. Every command runs on the host, never on the device showing the guide.
 */
export const cuaSetupSteps = (status: CuaStatus): CuaSetupStep[] => {
  const macOS = status.host.platform === "darwin";
  const steps: CuaSetupStep[] = [];
  if (status.status === "not-installed") steps.push(installStep);
  if (status.reason === "no-answer" || updateAvailable(status)) steps.push(updateStep(status));
  if (macOS && (status.status === "not-installed" || status.reason === "not-running")) {
    steps.push(startStep);
  }
  if (macOS && status.status !== "ready") steps.push(permissionsStep(missingGrants(status)));
  if (status.status !== "ready") steps.push(configStep);
  return steps;
};

const updateAvailable = (status: CuaStatus): boolean =>
  status.checks.some((check) => check.id === "up-to-date" && check.ok === false);

const missingGrants = (status: CuaStatus): CuaCheck[] =>
  status.checks.filter(
    (check) =>
      (check.id === "accessibility" || check.id === "screen-recording") && check.ok !== true,
  );

const installStep: CuaSetupStep = {
  id: "install",
  title: "Install CUA Driver",
  body: "Installs CuaDriver.app in /Applications and links `cua-driver` into ~/.local/bin. No sudo needed.",
  commands: [{ label: "Install", command: CUA_COMMANDS.install }],
  places: [],
};

const updateStep = (status: CuaStatus): CuaSetupStep => ({
  id: "update",
  title: status.reason === "no-answer" ? "Repair or update CUA Driver" : "Update CUA Driver",
  body:
    status.reason === "no-answer"
      ? "`cua-driver` is there but did not answer. Updating reinstalls it; `cua-driver doctor` says what is wrong."
      : `Version ${status.latestVersion ?? "a newer one"} is out (this host has ${status.version ?? "an older one"}). Updating stops its app; start it again afterwards.`,
  commands: [
    { label: "Check for an update", command: CUA_COMMANDS.checkUpdate },
    { label: "Update", command: CUA_COMMANDS.update },
    ...(status.reason === "no-answer"
      ? [{ label: "Diagnose", command: CUA_COMMANDS.doctor }]
      : [{ label: "Start it again", command: CUA_COMMANDS.start }]),
  ],
  places: [],
});

const startStep: CuaSetupStep = {
  id: "start",
  title: "Start CUA Driver",
  body: "Its app runs in the background and holds the macOS permissions; threads reach it through `cua-driver mcp`.",
  commands: [{ label: "Start", command: CUA_COMMANDS.start }],
  places: [],
};

const permissionsStep = (missing: CuaCheck[]): CuaSetupStep => {
  const names = missing.length > 0 ? missing.map((check) => check.label) : GRANT_NAMES;
  return {
    id: "permissions",
    title: "Grant the macOS permissions",
    body: `CUA Driver needs ${names.join(" and ")}, granted to the Cua Driver app (not to your terminal). The grant command opens the dialogs and verifies capture; on macOS Tahoe it also asks for direct capture consent. Someone has to click Allow at the host's screen.`,
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
  body: "CUA Driver needs no API key, and AOP hands its MCP server (`cua-driver mcp`) to this project's threads itself: nothing goes in your Claude Code config. Threads use the tools only with Thread access set to Full access.",
  commands: [],
  places: [],
};
