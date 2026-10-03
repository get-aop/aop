import { normalizeReleaseVersion } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { countRunningRuns } from "../scheduling/capacity.ts";
import { SettingKey } from "../settings/types.ts";
import { layoutOf, selfUpdateBlock, selfUpdateRefusal } from "./install-layout.ts";
import { feedConfigFromEnv } from "./release-feed.ts";
import { startUpdaterProcess } from "./spawn-updater.ts";
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
    autoApply:
      feed.channel === "nightly"
        ? {
            enabled: async () =>
              (await ctx.settingsRepository.get(SettingKey.UPDATE_AUTO_APPLY)) === "true",
            busy: async () => (await countRunningRuns(ctx.db)) > 0,
          }
        : undefined,
  });
};
