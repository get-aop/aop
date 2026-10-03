import { hostname } from "node:os";
import { type HostRestart, normalizeReleaseVersion } from "@aop/common";
import { readHostManagement } from "../auth/host-management.ts";
import type { LocalServerContext } from "../context.ts";
import { listRunningTurns } from "../scheduling/capacity.ts";
import { SettingKey } from "../settings/types.ts";
import {
  type InstallLayout,
  layoutOf,
  type SelfUpdateBlock,
  selfUpdateBlock,
  selfUpdateRefusal,
} from "./install-layout.ts";
import { feedConfigFromEnv } from "./release-feed.ts";
import { detectRestartPlan } from "./restart.ts";
import { startUpdaterProcess } from "./spawn-updater.ts";
import { systemPlanInput } from "./system.ts";
import { createUpdateService, type UpdateService } from "./update-service.ts";

/**
 * The update service of the host this process is. `AOP_BUILD_VERSION` is set by the compiled
 * `aop` when it starts the server; a source checkout has none, reports `dev`, and cannot update.
 */
export const createHostUpdateService = (
  ctx: LocalServerContext,
  env: NodeJS.ProcessEnv = process.env,
): UpdateService => {
  const buildVersion = env.AOP_BUILD_VERSION?.trim();
  const block = selfUpdateBlock(process.execPath, buildVersion);
  const layout = block === null ? layoutOf(process.execPath) : null;
  const feed = feedConfigFromEnv(env);
  return createUpdateService({
    isEnabled: async () => (await ctx.settingsRepository.get(SettingKey.UPDATE_CHECK)) === "true",
    unsupported: block === null ? null : selfUpdateRefusal(block, process.execPath),
    current: buildVersion ? normalizeReleaseVersion(buildVersion) : "dev",
    feed,
    startUpdater: async () => {
      if (!layout) throw new Error("not an installed build");
      await startUpdaterProcess(layout, env);
    },
    hostName: shortHostName(hostname()),
    restart: () => restartOf(block, layout, env),
    runningTurns: () => listRunningTurns(ctx.db),
    hostManagement: () => readHostManagement(ctx.settingsRepository),
    autoApply:
      feed.channel === "nightly"
        ? {
            enabled: async () =>
              (await ctx.settingsRepository.get(SettingKey.UPDATE_AUTO_APPLY)) === "true",
          }
        : undefined,
  });
};

// "soulf.local" and "soulf.tailffbdec.ts.net" are both "soulf" to the person.
export const shortHostName = (name: string): string => name.split(".")[0] || name;

// Read on each status call: a service can be installed while the host runs.
const restartOf = async (
  block: SelfUpdateBlock | null,
  layout: InstallLayout | null,
  env: NodeJS.ProcessEnv,
): Promise<HostRestart> => {
  if (block === "source" || block === "app") return block;
  if (!layout) return "manual";
  const plan = await detectRestartPlan({ ...systemPlanInput(env), layout });
  if (plan.kind === "launchd" || plan.kind === "systemd") return "service";
  return plan.kind;
};
