import {
  type CuaLeaseState,
  type CuaStatus,
  cuaHolderName,
  cuaSetupSteps,
  type SetupCheck,
} from "@aop/common";
import type { ComputerUseLook } from "./probes.ts";

const TITLE = "Computer use";

/**
 * "Computer use": CUA Driver's readiness on the host (computer-use/cua-driver.ts) and who holds
 * the computer-use lease. Missing pieces get a Fix when `aop computer-use setup` can add them
 * without a password, and a how-to with the one sudo command otherwise. With no project using
 * computer use it is optional: it says so and does not count against the checklist.
 */
export const computerUseCheck = (look: ComputerUseLook, command: string): SetupCheck => {
  const { status } = look;
  if (!look.wanted) {
    return {
      id: "computer-use",
      state: "optional",
      title: TITLE,
      detail:
        status.status === "ready"
          ? `${readyDetail(status, look.lease)} · no project uses it`
          : "Not set up · optional",
      actions: [],
    };
  }
  if (status.status === "ready") {
    return {
      id: "computer-use",
      state: "ok",
      title: TITLE,
      detail: readyDetail(status, look.lease),
      actions: [{ kind: "link", label: "Live view", target: "live-view" }],
    };
  }
  return {
    id: "computer-use",
    state: "warning",
    title: TITLE,
    detail: missingDetail(status),
    actions: [fixAction(status, command)],
  };
};

/** "CUA Driver 0.32.0 · screen :99 · Google Chrome · in use by "X", 1 thread waiting". */
const readyDetail = (status: CuaStatus, lease: CuaLeaseState): string =>
  [
    `CUA Driver ${status.version ?? status.fix.pinnedVersion}`,
    screenOf(status),
    browserOf(status),
    leaseOf(lease),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

const screenOf = (status: CuaStatus): string | null => {
  const detail = status.checks.find((check) => check.id === "display" && check.ok)?.detail;
  const display = detail && /X display (\S+) is up/.exec(detail)?.[1];
  return display ? `screen ${display}` : null;
};

// The check names the browser by the path CUA Driver launches (setup/linux-packages.ts).
const BROWSER_NAMES: [RegExp, string][] = [
  [/google-chrome/, "Google Chrome"],
  [/chromium/, "Chromium"],
  [/msedge/, "Microsoft Edge"],
];

const browserOf = (status: CuaStatus): string | null => {
  const browser = status.checks.find((check) => check.id === "browser" && check.ok);
  const found = browser?.detail.split(" (")[0];
  if (!found) return null;
  return BROWSER_NAMES.find(([pattern]) => pattern.test(found))?.[1] ?? found;
};

const leaseOf = (lease: CuaLeaseState): string | null => {
  if (!lease.holder) return null;
  const waiting = lease.queue.length;
  const holder = `in use by "${cuaHolderName(lease.holder)}"`;
  if (waiting === 0) return holder;
  return `${holder}, ${waiting} thread${waiting === 1 ? "" : "s"} waiting`;
};

/** "Missing: Screen, Xvfb. CUA Driver 0.32.0 is installed." */
const missingDetail = (status: CuaStatus): string => {
  const missing = missingPieces(status);
  const installed =
    status.status === "not-installed"
      ? ""
      : ` CUA Driver ${status.version ?? ""} is installed.`.replace("  ", " ");
  return missing.length > 0 ? `Missing: ${missing.join(", ")}.${installed}` : status.detail;
};

const missingPieces = (status: CuaStatus): string[] => {
  const failed = status.checks
    .filter((check) => check.ok === false && check.id !== "system-packages")
    .map((check) => check.label);
  const driver = status.status === "not-installed" ? ["CUA Driver"] : [];
  return [...new Set([...driver, ...failed, ...status.fix.missing])];
};

const fixAction = (status: CuaStatus, command: string): SetupCheck["actions"][number] => {
  const { sudoCommand } = status.fix;
  if (sudoCommand) {
    return {
      kind: "how-to",
      steps: [
        `Some of it needs root. On ${status.host.name}, run this once in a terminal (it asks for your password):`,
        `Then run \`${command}\` there, or press Check again.`,
      ],
      command: sudoCommand,
    };
  }
  if (status.fix.command) return { kind: "fix", label: "Fix" };
  return macHowTo(status, command);
};

// macOS permissions are granted in dialogs that only a terminal session on the Mac may open:
// the guide's own steps (cuaSetupSteps, the one place they are written), with where to click.
const macHowTo = (status: CuaStatus, command: string): SetupCheck["actions"][number] => {
  const guide = cuaSetupSteps(status);
  const steps = guide.flatMap((step) => [
    `${step.title}: ${step.body.replaceAll("`", "")}`,
    ...step.commands.slice(1).map((extra) => `${extra.label}: ${extra.command}`),
    ...step.places.map((place) => `Or by hand: ${place}`),
  ]);
  return {
    kind: "how-to",
    steps:
      steps.length > 0
        ? [`On ${status.host.name}, in a terminal:`, ...steps]
        : [
            `On ${status.host.name}, run this in a terminal. It starts CUA Driver and asks macOS for the permissions it needs.`,
          ],
    command: guide[0]?.commands[0]?.command ?? command,
  };
};
