import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildChannel, type ChannelConfig } from "@aop/common";
import type { InstallLayout } from "./install-layout.ts";

// The names install.sh registers for this build's channel; the restart has to talk to the same
// service, and AOP Nightly's service is not stable's.
export const launchdLabelOf = (channel: ChannelConfig = buildChannel()): string =>
  channel.launchdLabel;
export const systemdUnitOf = (channel: ChannelConfig = buildChannel()): string =>
  `${channel.systemdUnit}.service`;
export const LAUNCHD_LABEL = launchdLabelOf();
export const SYSTEMD_UNIT = systemdUnitOf();

/** How the host runs, which decides how it is restarted onto a new binary. */
export type RestartPlan =
  | { kind: "launchd"; plist: string }
  | { kind: "systemd"; unit: string }
  | { kind: "background"; pidFile: string; pid: number; port: number }
  /** Started by hand in a terminal, or not running: nothing here can start it again. */
  | { kind: "manual" };

export interface RestartTools {
  /** Runs a command and returns its exit code. */
  run: (command: string[]) => Promise<number>;
  kill: (pid: number) => void;
  /** Resolves once nothing answers on the host's port any more, or false on timeout. */
  waitUntilDown: () => Promise<boolean>;
}

export interface PlanInput {
  layout: InstallLayout;
  home: string;
  /** `darwin` or `linux`. */
  os: string;
  pidFile: string;
  port: number;
  /** Whether process `pid` is running `binaryPath`: a recycled pid must not be taken for the host. */
  runsBinary: (pid: number, binaryPath: string) => boolean;
  /** Whose service names to look for; this build's channel unless a test says otherwise. */
  channel?: ChannelConfig;
}

/**
 * Works out how this install is kept running, by the files install.sh and `aop run --background`
 * leave behind. A service only counts when it points at THIS binary, so an install in another
 * folder never restarts somebody else's service.
 */
export const detectRestartPlan = async (input: PlanInput): Promise<RestartPlan> => {
  const { layout, home, os } = input;
  if (os === "darwin") {
    const plist = join(home, "Library", "LaunchAgents", `${launchdLabelOf(input.channel)}.plist`);
    if ((await readText(plist)).includes(`<string>${layout.binaryPath}</string>`)) {
      return { kind: "launchd", plist };
    }
  }
  if (os === "linux") {
    const unitName = systemdUnitOf(input.channel);
    const unit = join(home, ".config", "systemd", "user", unitName);
    if ((await readText(unit)).includes(`ExecStart=${layout.binaryPath} `)) {
      return { kind: "systemd", unit: unitName };
    }
  }
  const pid = Number.parseInt((await readText(input.pidFile)).trim(), 10);
  if (Number.isInteger(pid) && input.runsBinary(pid, layout.binaryPath)) {
    return { kind: "background", pidFile: input.pidFile, pid, port: input.port };
  }
  return { kind: "manual" };
};

/** Restarts the host the way it runs. Throws when the service manager refuses. */
export const restartHost = async (
  plan: RestartPlan,
  layout: InstallLayout,
  tools: RestartTools,
): Promise<void> => {
  switch (plan.kind) {
    case "launchd":
      // The same unload and load install.sh does, so the plist is reread as well.
      await tools.run(["launchctl", "unload", plan.plist]);
      return expectOk(await tools.run(["launchctl", "load", "-w", plan.plist]), "launchctl load");
    case "systemd":
      return expectOk(
        await tools.run(["systemctl", "--user", "restart", plan.unit]),
        "systemctl restart",
      );
    case "background":
      return restartBackground(plan, layout, tools);
    case "manual":
      throw new Error(
        `The host was not started as a service or with \`${buildChannel().binaryName} run --background\``,
      );
  }
};

const restartBackground = async (
  plan: Extract<RestartPlan, { kind: "background" }>,
  layout: InstallLayout,
  tools: RestartTools,
): Promise<void> => {
  tools.kill(plan.pid);
  if (!(await tools.waitUntilDown())) throw new Error("The old host did not stop");
  expectOk(
    await tools.run([layout.binaryPath, "run", "--background", "--port", String(plan.port)]),
    "aop run --background",
  );
};

const expectOk = (exitCode: number, what: string): void => {
  if (exitCode !== 0) throw new Error(`${what} failed (exit ${exitCode})`);
};

const readText = (path: string): Promise<string> => readFile(path, "utf8").catch(() => "");
