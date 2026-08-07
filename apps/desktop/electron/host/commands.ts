import type { DesktopSetupState } from "../../src/setup/types";
import { createInstallerRegistry, type InstallerTooling, type SetupActionPlan } from "./installers";
import { currentPlatform } from "./platform";
import {
  collectSetupState,
  createSystemCommandRunner,
  detectInstallerTooling,
  missingWslSetupState,
} from "./setup";
import type { CommandOutput, CommandRunner, HostPlatform } from "./types";
import {
  createWslCommandRunner,
  listWslDistros,
  loadExecHost,
  resolveWindowsExecHost,
  saveExecHost,
} from "./wsl";

export const getSystemSetupState = async (): Promise<DesktopSetupState> => {
  const platform = currentPlatform();
  if (platform === "unix") return collectSetupState(createSystemCommandRunner(), platform);

  const current = await loadExecHost();
  const distros = await listWslDistros().catch(() => []);
  const mode = resolveWindowsExecHost(current, distros);
  if (mode?.kind !== "wsl") return missingWslSetupState();
  if (mode.kind !== current.kind || (current.kind === "wsl" && mode.distro !== current.distro)) {
    await saveExecHost(mode).catch(() => undefined);
  }
  return collectSetupState(createWslCommandRunner(mode.distro), platform);
};

export const runSetupActionWithRunner = async (
  actionId: string,
  runner: CommandRunner,
  platform: HostPlatform,
  tooling: InstallerTooling,
): Promise<DesktopSetupState> => {
  let plan: SetupActionPlan;
  try {
    plan = createInstallerRegistry(platform, tooling).plan(actionId);
  } catch {
    throw new Error("Unknown setup action.");
  }

  if (plan.kind === "command" && plan.command) {
    const output = await runner.run(plan.command);
    if (output.status !== 0) throw new Error(commandFailureMessage(output));
  }
  return collectSetupState(runner, platform);
};

export const runSystemSetupAction = async (actionId: string): Promise<DesktopSetupState> => {
  const platform = currentPlatform();
  let runner: CommandRunner;
  if (platform === "windows") {
    const mode = await loadExecHost();
    if (mode.kind !== "wsl") {
      throw new Error("A WSL 2 distro must be selected before running setup actions.");
    }
    runner = createWslCommandRunner(mode.distro);
  } else {
    runner = createSystemCommandRunner();
  }
  const tooling = await detectInstallerTooling(platform, runner);
  return runSetupActionWithRunner(actionId, runner, platform, tooling);
};

const commandFailureMessage = (output: CommandOutput): string => {
  if (output.stderr.trim()) return output.stderr.trim();
  if (output.stdout.trim()) return output.stdout.trim();
  return `Command exited with status ${output.status}.`;
};
