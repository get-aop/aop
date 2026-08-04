import type { LocalServerContext } from "../../context.ts";
import { SettingKey } from "../../settings/types.ts";
import { readFreshJiraTokenSet, refreshJiraTokens } from "./oauth-token-refresh.ts";

export interface JiraOAuthAccess {
  accessToken: string;
  cloudId: string;
  siteUrl: string;
}

export const getJiraOAuthAccess = async (
  ctx: LocalServerContext,
): Promise<JiraOAuthAccess | null> => {
  const status = await ctx.jiraTokenStore.getStatus();
  if (!status.connected) {
    return null;
  }

  if (status.locked) {
    throw new Error("Jira token store is locked");
  }

  const tokens = await readFreshJiraTokenSet({
    tokenStore: ctx.jiraTokenStore,
    getCredentials: () => getConfiguredJiraCredentials(ctx),
    refreshTokens: refreshJiraTokens,
  });

  return {
    accessToken: tokens.accessToken,
    cloudId: tokens.cloudId,
    siteUrl: tokens.siteUrl,
  };
};

const getConfiguredJiraCredentials = async (
  ctx: LocalServerContext,
): Promise<{ clientId: string; clientSecret: string }> => {
  const [configuredClientId, configuredClientSecret] = await Promise.all([
    ctx.settingsRepository.get(SettingKey.JIRA_CLIENT_ID),
    ctx.settingsRepository.get(SettingKey.JIRA_CLIENT_SECRET),
  ]);
  return {
    clientId: configuredClientId || process.env.AOP_JIRA_CLIENT_ID || "",
    clientSecret: configuredClientSecret || process.env.AOP_JIRA_CLIENT_SECRET || "",
  };
};
