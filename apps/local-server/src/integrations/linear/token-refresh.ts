import type { LinearTokenSet, LinearTokenStore } from "./types.ts";

const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000;

interface ReadFreshLinearTokenSetOptions {
  getClientId: () => Promise<string>;
  now?: () => Date;
  refreshSkewMs?: number;
  refreshTokens: (params: { clientId: string; refreshToken: string }) => Promise<LinearTokenSet>;
  tokenStore: LinearTokenStore;
}

interface RefreshLinearTokensOptions {
  fetch?: typeof fetch;
  now?: () => Date;
}

export const readFreshLinearTokenSet = async (
  options: ReadFreshLinearTokenSetOptions,
): Promise<LinearTokenSet> => {
  const tokens = await options.tokenStore.read();
  if (!shouldRefresh(tokens, options)) {
    return tokens;
  }

  const clientId = await options.getClientId();
  if (!clientId) {
    throw new Error("Linear OAuth is not configured");
  }

  const refreshedTokens = await options.refreshTokens({
    clientId,
    refreshToken: tokens.refreshToken,
  });
  await options.tokenStore.save(refreshedTokens);
  return refreshedTokens;
};

export const refreshLinearTokens = async (
  params: { clientId: string; refreshToken: string },
  options: RefreshLinearTokensOptions = {},
): Promise<LinearTokenSet> => {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: params.clientId,
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const suffix = errorBody ? `: ${errorBody}` : "";
    throw new Error(`Linear OAuth token refresh failed (${response.status})${suffix}`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!body.access_token || typeof body.expires_in !== "number") {
    throw new Error("Linear OAuth token refresh returned an invalid payload");
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
  tokens: LinearTokenSet,
  options: Pick<ReadFreshLinearTokenSetOptions, "now" | "refreshSkewMs">,
): boolean => {
  const expiresAtMs = Date.parse(tokens.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  const nowMs = (options.now?.() ?? new Date()).getTime();
  const refreshSkewMs = options.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  return expiresAtMs - nowMs <= refreshSkewMs;
};
