import type { LocalServerContext } from "../../context.ts";
import { SettingKey } from "../../settings/types.ts";
import { readFreshLinearTokenSet, refreshLinearTokens } from "./token-refresh.ts";

export const getLinearAccessToken = async (ctx: LocalServerContext): Promise<string | null> => {
  const status = await ctx.linearTokenStore.getStatus();
  if (!status.connected) {
    return null;
  }

  if (status.locked) {
    throw new Error("Linear token store is locked");
  }

  const tokens = await readFreshLinearTokenSet({
    tokenStore: ctx.linearTokenStore,
    getClientId: async () => getConfiguredLinearClientId(ctx),
    refreshTokens: refreshLinearTokens,
  });
  return tokens.accessToken;
};

const getConfiguredLinearClientId = async (ctx: LocalServerContext): Promise<string> => {
  const configuredClientId = await ctx.settingsRepository.get(SettingKey.LINEAR_CLIENT_ID);
  return configuredClientId || process.env.AOP_LINEAR_CLIENT_ID || "";
};
