import type { JiraTokenSet } from "./oauth-types.ts";

const JIRA_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const JIRA_ACCESSIBLE_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
const JIRA_API_BASE = "https://api.atlassian.com/ex/jira";

export interface JiraAccountInfo {
  accountId: string;
  displayName: string;
  emailAddress: string;
}

export const exchangeJiraCodeForTokens = async (params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<JiraTokenSet> => {
  const tokens = await postJiraTokenExchange(params);
  const resource = await resolveJiraAccessibleResource(tokens.accessToken);

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    cloudId: resource.id,
    siteUrl: resource.url,
    siteName: resource.name,
  };
};

export const testJiraOAuthConnection = async ({
  accessToken,
  cloudId,
}: {
  accessToken: string;
  cloudId: string;
}): Promise<JiraAccountInfo> => {
  const response = await fetch(`${JIRA_API_BASE}/${cloudId}/rest/api/3/myself`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await buildFailureMessage("Jira connection test failed", response));
  }

  const body = (await response.json()) as {
    accountId?: string | null;
    displayName?: string | null;
    emailAddress?: string | null;
  };

  return {
    accountId: body.accountId ?? "",
    displayName: body.displayName ?? "",
    emailAddress: body.emailAddress ?? "",
  };
};

const postJiraTokenExchange = async (params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> => {
  const response = await fetch(JIRA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(await buildFailureMessage("Jira OAuth token exchange failed", response));
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!body.access_token || !body.refresh_token || typeof body.expires_in !== "number") {
    throw new Error("Jira OAuth token exchange returned an invalid payload");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
  };
};

const resolveJiraAccessibleResource = async (
  accessToken: string,
): Promise<{ id: string; name: string; url: string }> => {
  const response = await fetch(JIRA_ACCESSIBLE_RESOURCES_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(await buildFailureMessage("Jira accessible resources lookup failed", response));
  }

  const resources = (await response.json()) as Array<{
    id?: string;
    name?: string;
    url?: string;
  }>;

  const resource = resources[0];
  if (!resource?.id || !resource.url) {
    throw new Error("No accessible Jira sites for this token");
  }

  return {
    id: resource.id,
    name: resource.name ?? "",
    url: resource.url,
  };
};

const buildFailureMessage = async (message: string, response: Response): Promise<string> => {
  const errorBody = await response.text().catch(() => "");
  const suffix = errorBody ? `: ${errorBody}` : "";
  return `${message} (${response.status})${suffix}`;
};
