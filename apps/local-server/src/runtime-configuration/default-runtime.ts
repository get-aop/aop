import { BUILT_IN_RUNTIME_ID } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { SettingKey } from "../settings/types.ts";
import type { RuntimeConfigurationRepository } from "./repository.ts";

/**
 * The runtime new projects start on: the host's `default_runtime_id`, or the built-in one when
 * that runtime is gone (a setting written by hand, or a database restored from elsewhere).
 */
export const readDefaultRuntimeId = async (
  ctx: Pick<LocalServerContext, "settingsRepository">,
  configurations: RuntimeConfigurationRepository,
): Promise<string> => {
  const id = await ctx.settingsRepository.get(SettingKey.DEFAULT_RUNTIME);
  return (await configurations.get(id)) ? id : BUILT_IN_RUNTIME_ID;
};
