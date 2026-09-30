import { normalizeReleaseVersion } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { SettingKey } from "../settings/types.ts";
import { detectInstall } from "./install-layout.ts";
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
  const layout = detectInstall(process.execPath, buildVersion);
  return createUpdateService({
    isEnabled: async () => (await ctx.settingsRepository.get(SettingKey.UPDATE_CHECK)) === "true",
    supported: layout !== null,
    current: buildVersion ? normalizeReleaseVersion(buildVersion) : "dev",
    feed: feedConfigFromEnv(env),
    startUpdater: async () => {
      if (!layout) throw new Error("not an installed build");
      await startUpdaterProcess(layout, env);
    },
  });
};
