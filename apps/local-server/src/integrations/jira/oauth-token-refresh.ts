import type { JiraTokenSet, JiraTokenStore } from "./oauth-types.ts";

const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

export interface RefreshedJiraTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

interface RefreshJiraTokensParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface ReadFreshJiraTokenSetOptions {
  getCredentials: () =>
    | Promise<{ clientId: string; clientSecret: string }>
    | {
        clientId: string;
        clientSecret: string;
      };
  now?: () => Date;
  refreshSkewMs?: number;
  refreshTokens: (params: RefreshJiraTokensParams) => Promise<RefreshedJiraTokens>;
  tokenStore: JiraTokenStore;
}

interface RefreshJiraTokensOptions {
  fetch?: typeof fetch;
  now?: () => Date;
}

export const readFreshJiraTokenSet = async (
  options: ReadFreshJiraTokenSetOptions,
): Promise<JiraTokenSet> => {
  const tokens = await options.tokenStore.read();
  if (!shouldRefresh(tokens, options)) {
    return tokens;
  }

  const { clientId, clientSecret } = await options.getCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Jira OAuth is not configured");
  }

  const refreshed = await options.refreshTokens({
    clientId,
    clientSecret,
    refreshToken: tokens.refreshToken,
  });

  const merged: JiraTokenSet = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    cloudId: tokens.cloudId,
    siteUrl: tokens.siteUrl,
    siteName: tokens.siteName,
  };
  await options.tokenStore.save(merged);
  return merged;
};

export const refreshJiraTokens = async (
  params: RefreshJiraTokensParams,
  options: RefreshJiraTokensOptions = {},
): Promise<RefreshedJiraTokens> => {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(JIRA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const suffix = errorBody ? `: ${errorBody}` : "";
    throw new Error(`Jira OAuth token refresh failed (${response.status})${suffix}`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!body.access_token || typeof body.expires_in !== "number") {
    throw new Error("Jira OAuth token refresh returned an invalid payload");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? params.refreshToken,
    expiresAt: new Date(
      (options.now?.() ?? new Date()).getTime() + body.expires_in * 1000,
    ).toISOString(),
  };
};

const shouldRefresh = (
  tokens: JiraTokenSet,
  options: Pick<ReadFreshJiraTokenSetOptions, "now" | "refreshSkewMs">,
): boolean => {
  const expiresAtMs = Date.parse(tokens.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  const nowMs = (options.now?.() ?? new Date()).getTime();
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  return expiresAtMs - nowMs <= refreshSkewMs;
};
