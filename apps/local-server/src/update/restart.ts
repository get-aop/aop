import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstallLayout } from "./install-layout.ts";

// The names install.sh registers; the restart has to talk to the same service.
export const LAUNCHD_LABEL = "com.aop.local-server";
export const SYSTEMD_UNIT = "aop-local-server.service";

/** How the host runs, which decides how it is restarted onto a new binary. */
export type RestartPlan =
  | { kind: "launchd"; plist: string }
  | { kind: "systemd" }
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
}

/**
 * Works out how this install is kept running, by the files install.sh and `aop run --background`
 * leave behind. A service only counts when it points at THIS binary, so an install in another
 * folder never restarts somebody else's service.
 */
export const detectRestartPlan = async (input: PlanInput): Promise<RestartPlan> => {
  const { layout, home, os } = input;
  if (os === "darwin") {
    const plist = join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    if ((await readText(plist)).includes(`<string>${layout.binaryPath}</string>`)) {
      return { kind: "launchd", plist };
    }
  }
  if (os === "linux") {
    const unit = join(home, ".config", "systemd", "user", SYSTEMD_UNIT);
    if ((await readText(unit)).includes(`ExecStart=${layout.binaryPath} `)) {
      return { kind: "systemd" };
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
        await tools.run(["systemctl", "--user", "restart", SYSTEMD_UNIT]),
        "systemctl restart",
      );
    case "background":
      return restartBackground(plan, layout, tools);
    case "manual":
      throw new Error("The host was not started as a service or with `aop run --background`");
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
