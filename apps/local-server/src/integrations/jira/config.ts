import type { LocalServerContext } from "../../context.ts";
import { SettingKey } from "../../settings/types.ts";
import type { CreateJiraClientOptions } from "./client.ts";
import { getJiraOAuthAccess } from "./oauth-access-token.ts";

export interface JiraConfig
  extends Required<Pick<CreateJiraClientOptions, "siteUrl" | "email" | "apiToken">> {
  configured: boolean;
}

export interface JiraStatus {
  configured: boolean;
  siteUrl: string | null;
  email: string | null;
}

export const getJiraConfig = async (ctx: LocalServerContext): Promise<JiraConfig> => {
  const [siteUrlSetting, emailSetting, tokenSetting] = await Promise.all([
    ctx.settingsRepository.get(SettingKey.JIRA_SITE_URL),
    ctx.settingsRepository.get(SettingKey.JIRA_EMAIL),
    ctx.settingsRepository.get(SettingKey.JIRA_API_TOKEN),
  ]);
  const siteUrl = normalizeSiteUrl(
    firstNonEmpty(siteUrlSetting, process.env.AOP_JIRA_SITE_URL, process.env.JIRA_SITE_URL),
  );
  const email = firstNonEmpty(emailSetting, process.env.AOP_JIRA_EMAIL, process.env.JIRA_EMAIL);
  const apiToken = firstNonEmpty(
    tokenSetting,
    process.env.AOP_JIRA_API_TOKEN,
    process.env.JIRA_API_TOKEN,
  );

  return {
    siteUrl,
    email,
    apiToken,
    configured: siteUrl.length > 0 && email.length > 0 && apiToken.length > 0,
  };
};

export const resolveJiraClientOptions = async (
  ctx: LocalServerContext,
): Promise<CreateJiraClientOptions> => {
  const oauthStatus = await ctx.jiraTokenStore.getStatus();
  if (oauthStatus.connected) {
    if (oauthStatus.locked) {
      throw new Error("Jira token store is locked");
    }

    const access = await getJiraOAuthAccess(ctx);
    if (access) {
      return {
        siteUrl: access.siteUrl,
        accessToken: access.accessToken,
        cloudId: access.cloudId,
      };
    }
  }

  const config = await getJiraConfig(ctx);
  if (!config.configured) {
    throw new Error("Jira is not configured");
  }

  return {
    siteUrl: config.siteUrl,
    email: config.email,
    apiToken: config.apiToken,
  };
};

export const getJiraStatus = async (ctx: LocalServerContext): Promise<JiraStatus> => {
  const config = await getJiraConfig(ctx);
  return {
    configured: config.configured,
    siteUrl: config.siteUrl || null,
    email: config.email || null,
  };
};

const firstNonEmpty = (...values: Array<string | undefined>): string => {
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "";
};

const normalizeSiteUrl = (siteUrl: string): string => siteUrl.replace(/\/+$/, "");
