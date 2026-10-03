import { CUA_DRIVER_VERSION, type CuaStatus } from "@aop/common";
import { computerUseConfigPath } from "../config.ts";
import { probeCua } from "../cua-driver.ts";
import { driverAction, findDriver, installDriver } from "./driver-install.ts";
import { setupLinux } from "./linux-setup.ts";
import { setupMac } from "./mac.ts";
import { hostSystem, type SetupSystem } from "./system.ts";

/**
 * `aop computer-use setup`: makes this host ready for threads to use the computer, and can be run
 * again at any time (it changes only what is missing or different). The install script runs it.
 *
 * 1. CUA Driver at the version AOP pins, installed or upgraded with CUA's installer (no sudo).
 * 2. Linux: the screen. A virtual display by default (Xvfb + openbox as user services started at
 *    boot, with linger); when a desktop session is up and someone is at the terminal, it asks
 *    whether to use that desktop instead.
 * 3. Linux: the system packages that need root, as ONE sudo command: run after asking when
 *    someone is at the terminal, printed otherwise.
 * 4. macOS: starts Cua Driver's app and, only from a terminal and after asking, opens the
 *    permission dialogs. A thread never triggers them.
 * 5. The choice goes to `<AOP home>/computer-use.json`, which the host reads on every use.
 */
export interface SetupIO {
  print: (line: string) => void;
  /** Someone can answer questions and type a sudo password. */
  interactive: boolean;
  /** Asks a yes/no question; answers `fallback` when nobody can answer. */
  confirm: (question: string, fallback: boolean) => Promise<boolean>;
}

export interface SetupOptions {
  screen?: "virtual" | "desktop";
  display?: string;
  /** Never run sudo, even from a terminal: only print the command. */
  noSudo?: boolean;
  /** Leave the driver as it is (only the screen and packages). */
  skipDriver?: boolean;
  configPath?: string;
  /** The host's command, for the lines that tell the person what to run (`aop` / `aop-nightly`). */
  command?: string;
}

export interface SetupDeps {
  sys: SetupSystem;
  io: SetupIO;
  probe: () => Promise<CuaStatus>;
}

/** Runs setup and answers the exit code: 0 ready, 2 something is still missing, 1 a step failed. */
export const runComputerUseSetup = async (
  options: SetupOptions,
  deps: SetupDeps = defaultSetupDeps(),
): Promise<number> => {
  const { sys, io } = deps;
  const configPath = options.configPath ?? computerUseConfigPath();
  io.print(`Setting up computer use (CUA Driver ${CUA_DRIVER_VERSION}) for AOP on this host.`);
  if (!options.skipDriver && !(await setupDriver(sys, io))) return 1;
  if (sys.platform === "linux") {
    await setupLinux(sys, io, options, configPath);
  } else if (sys.platform === "darwin") {
    await setupMac(sys, io);
  } else {
    io.print("Computer use runs on a macOS or Linux host only.");
    return 2;
  }
  const status = await deps.probe();
  printStatus(io.print, status);
  return status.status === "ready" ? 0 : 2;
};

const setupDriver = async (sys: SetupSystem, io: SetupIO): Promise<boolean> => {
  const installed = await findDriver(sys);
  const action = driverAction(installed, CUA_DRIVER_VERSION);
  if (action === "none") {
    io.print(`✓ CUA Driver ${installed?.version} at ${installed?.path}`);
    return true;
  }
  const verb = { install: "Installing", upgrade: "Upgrading", repair: "Reinstalling" }[action];
  io.print(`${verb} CUA Driver ${CUA_DRIVER_VERSION} (CUA's installer, in your home folder)…`);
  const result = await installDriver(sys, CUA_DRIVER_VERSION, { interactive: io.interactive });
  if (!result.ok) {
    io.print(
      `✗ Installing CUA Driver failed:\n${result.output.trim().split("\n").slice(-15).join("\n")}`,
    );
    return false;
  }
  const after = await findDriver(sys);
  io.print(
    `✓ CUA Driver ${after?.version ?? CUA_DRIVER_VERSION} at ${after?.path ?? "~/.local/bin/cua-driver"}`,
  );
  return true;
};

/** `aop computer-use status`: the host's readiness, as the dashboard shows it. */
export const printStatus = (print: (line: string) => void, status: CuaStatus): void => {
  const word = { ready: "ready", "not-ready": "not ready", "not-installed": "not installed" }[
    status.status
  ];
  print(`Computer use on ${status.host.name}: ${word}. ${status.detail}`);
  for (const check of status.checks) print(`  ${markOf(check)} ${check.label}: ${check.detail}`);
  if (status.fix.sudoCommand) print(`Needs root (run once): ${status.fix.sudoCommand}`);
  if (status.fix.command) print(`Then run: ${status.fix.command}`);
};

// ✓ fine, ✗ missing and needed, ! missing but optional, · not checked.
const markOf = (check: CuaStatus["checks"][number]): string => {
  if (check.ok === null) return "·";
  if (check.ok) return "✓";
  return check.required ? "✗" : "!";
};

/** `aop computer-use status`. Exit code 0 when ready, 2 otherwise. */
export const runComputerUseStatus = async (
  options: { json?: boolean },
  print: (line: string) => void,
  probe: () => Promise<CuaStatus> = () => probeCua(),
): Promise<number> => {
  const status = await probe();
  if (options.json) print(JSON.stringify(status, null, 2));
  else printStatus(print, status);
  return status.status === "ready" ? 0 : 2;
};

const defaultSetupDeps = (): SetupDeps => ({
  sys: hostSystem(),
  io: terminalIO(),
  probe: () => probeCua(),
});

/** Questions go to the terminal only when both ends of it are a person's. */
export const terminalIO = (
  print: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): SetupIO => {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  return {
    print,
    interactive,
    confirm: async (question, fallback) => {
      if (!interactive) return fallback;
      const answer = prompt(`${question} [${fallback ? "Y/n" : "y/N"}]`)
        ?.trim()
        .toLowerCase();
      if (!answer) return fallback;
      return answer.startsWith("y");
    },
  };
};
