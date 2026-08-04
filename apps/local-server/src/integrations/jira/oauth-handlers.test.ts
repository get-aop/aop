import { describe, expect, mock, test } from "bun:test";
import { createJiraOAuth } from "./oauth.ts";
import { createJiraOAuthHandlers, JiraOAuthHandlersError } from "./oauth-handlers.ts";
import type { JiraTokenSet, JiraTokenStore } from "./oauth-types.ts";

const TOKEN_SET: JiraTokenSet = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: "2999-01-01T00:00:00.000Z",
  cloudId: "cloud-123",
  siteUrl: "https://acme.atlassian.net",
  siteName: "Acme",
};

const buildTokenStore = (overrides: Partial<JiraTokenStore> = {}): JiraTokenStore => ({
  save: async () => {},
  getStatus: async () => ({ connected: false, locked: false }),
  unlock: async () => {},
  read: async () => TOKEN_SET,
  lock: async () => {},
  disconnect: async () => {},
  ...overrides,
});

const ACCOUNT = {
  accountId: "acct-1",
  displayName: "Jane Doe",
  emailAddress: "jane@example.com",
};

describe("integrations/jira/oauth-handlers", () => {
  test("uses the current saved config to build the authorization URL", async () => {
    const getConfig = mock(async () => ({
      enabled: true,
      clientId: "jira-client-id",
      clientSecret: "jira-client-secret",
      redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
    }));

    const handlers = createJiraOAuthHandlers({
      createAuth: createJiraOAuth,
      getConfig,
      tokenStore: buildTokenStore(),
      exchangeCodeForTokens: async () => TOKEN_SET,
      refreshTokens: async () => ({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      testConnectionWithToken: async () => ACCOUNT,
    });

    const result = await handlers.connect();
    const authorizeUrl = new URL(result.authorizeUrl);

    expect(getConfig).toHaveBeenCalledTimes(1);
    expect(authorizeUrl.origin).toBe("https://auth.atlassian.com");
    expect(authorizeUrl.searchParams.get("client_id")).toBe("jira-client-id");
    expect(authorizeUrl.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:4310/api/jira/oauth/callback",
    );
  });

  test("keeps the original connect config for the callback exchange and saves tokens", async () => {
    let currentConfig = {
      enabled: true,
      clientId: "jira-client-id-a",
      clientSecret: "jira-secret-a",
      redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
    };

    const exchangeCodeForTokens = mock(async () => TOKEN_SET);
    const save = mock(async () => {});

    const handlers = createJiraOAuthHandlers({
      createAuth: createJiraOAuth,
      getConfig: async () => currentConfig,
      tokenStore: buildTokenStore({ save }),
      exchangeCodeForTokens,
      refreshTokens: async () => ({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      testConnectionWithToken: async () => ACCOUNT,
    });

    const connectResult = await handlers.connect();
    const state = new URL(connectResult.authorizeUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    currentConfig = {
      enabled: true,
      clientId: "jira-client-id-b",
      clientSecret: "jira-secret-b",
      redirectUri: "http://127.0.0.1:9999/api/jira/oauth/callback",
    };

    const callbackResult = await handlers.callback({ code: "oauth-code", state });

    expect(callbackResult).toEqual({ connected: true });
    expect(exchangeCodeForTokens).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForTokens).toHaveBeenCalledWith({
      clientId: "jira-client-id-a",
      clientSecret: "jira-secret-a",
      code: "oauth-code",
      redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
    });
    expect(save).toHaveBeenCalledWith(TOKEN_SET);
  });

  test("rejects a callback with an unknown state", async () => {
    const handlers = createJiraOAuthHandlers({
      createAuth: createJiraOAuth,
      getConfig: async () => ({
        enabled: true,
        clientId: "id",
        clientSecret: "secret",
        redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
      }),
      tokenStore: buildTokenStore(),
      exchangeCodeForTokens: async () => TOKEN_SET,
      refreshTokens: async () => ({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      testConnectionWithToken: async () => ACCOUNT,
    });

    await expect(handlers.callback({ code: "oauth-code", state: "unknown" })).rejects.toEqual(
      new JiraOAuthHandlersError(400, "Invalid Jira OAuth state"),
    );
  });

  test("returns a helpful configuration error when Jira OAuth is not configured", async () => {
    const handlers = createJiraOAuthHandlers({
      createAuth: createJiraOAuth,
      getConfig: async () => ({
        enabled: false,
        clientId: "",
        clientSecret: "",
        redirectUri: "",
      }),
      tokenStore: buildTokenStore(),
      exchangeCodeForTokens: async () => TOKEN_SET,
      refreshTokens: async () => ({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      testConnectionWithToken: async () => ACCOUNT,
    });

    await expect(handlers.connect()).rejects.toEqual(
      new JiraOAuthHandlersError(
        503,
        "Jira OAuth is not configured. Set jira_client_id, jira_client_secret, and jira_callback_url in Settings or via the CLI.",
      ),
    );
  });

  test("getStatus, unlock, and disconnect delegate to the token store", async () => {
    const getStatus = mock(async () => ({ connected: true, locked: true }));
    const unlock = mock(async () => {});
    const disconnect = mock(async () => {});

    const handlers = createJiraOAuthHandlers({
      createAuth: createJiraOAuth,
      getConfig: async () => ({
        enabled: true,
        clientId: "id",
        clientSecret: "secret",
        redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
      }),
      tokenStore: buildTokenStore({ getStatus, unlock, disconnect }),
      exchangeCodeForTokens: async () => TOKEN_SET,
      refreshTokens: async () => ({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      testConnectionWithToken: async () => ACCOUNT,
    });

    expect(await handlers.getStatus()).toEqual({ connected: true, locked: true });
    await handlers.unlock();
    await handlers.disconnect();
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test("refreshes expired tokens and reports the resolved site on testConnection", async () => {
    const expiredTokens: JiraTokenSet = {
      accessToken: "expired-access",
      refreshToken: "expired-refresh",
      expiresAt: "2000-01-01T00:00:00.000Z",
      cloudId: "cloud-123",
      siteUrl: "https://acme.atlassian.net",
      siteName: "Acme",
    };
    const save = mock(async () => {});
    const refreshTokens = mock(async () => ({
      accessToken: "fresh-access",
      refreshToken: "rotated-refresh",
      expiresAt: "2999-01-01T00:00:00.000Z",
    }));
    const testConnectionWithToken = mock(async () => ACCOUNT);

    const handlers = createJiraOAuthHandlers({
      createAuth: createJiraOAuth,
      getConfig: async () => ({
        enabled: true,
        clientId: "jira-client-id",
        clientSecret: "jira-client-secret",
        redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
      }),
      tokenStore: buildTokenStore({
        getStatus: async () => ({ connected: true, locked: false }),
        read: async () => expiredTokens,
        save,
      }),
      exchangeCodeForTokens: async () => TOKEN_SET,
      refreshTokens,
      testConnectionWithToken,
    });

    const result = await handlers.testConnection();

    expect(refreshTokens).toHaveBeenCalledWith({
      clientId: "jira-client-id",
      clientSecret: "jira-client-secret",
      refreshToken: "expired-refresh",
    });
    expect(testConnectionWithToken).toHaveBeenCalledWith("fresh-access", "cloud-123");
    expect(result).toEqual({
      ok: true,
      siteName: "Acme",
      siteUrl: "https://acme.atlassian.net",
      accountId: "acct-1",
      accountDisplayName: "Jane Doe",
      accountEmail: "jane@example.com",
    });
  });

  test("returns a 409 when the token store is locked during testConnection", async () => {
    const handlers = createJiraOAuthHandlers({
      createAuth: createJiraOAuth,
      getConfig: async () => ({
        enabled: true,
        clientId: "id",
        clientSecret: "secret",
        redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
      }),
      tokenStore: buildTokenStore({
        getStatus: async () => ({ connected: true, locked: true }),
        read: async () => {
          throw new Error("Jira token store is locked");
        },
      }),
      exchangeCodeForTokens: async () => TOKEN_SET,
      refreshTokens: async () => ({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
      testConnectionWithToken: async () => ACCOUNT,
    });

    await expect(handlers.testConnection()).rejects.toEqual(
      new JiraOAuthHandlersError(409, "Jira token store is locked"),
    );
  });
});
