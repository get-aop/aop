import type { RefreshedJiraTokens } from "./oauth-token-refresh.ts";
import { readFreshJiraTokenSet } from "./oauth-token-refresh.ts";
import type {
  JiraCallbackParams,
  JiraOAuth,
  JiraOAuthConnectionInfo,
  JiraTokenSet,
  JiraTokenStore,
} from "./oauth-types.ts";

export interface JiraOAuthHandlers {
  connect(): Promise<{ authorizeUrl: string }>;
  callback(params: JiraCallbackParams): Promise<{ connected: boolean }>;
  getStatus(): Promise<{ connected: boolean; locked: boolean }>;
  unlock(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<JiraOAuthConnectionInfo>;
}

export interface JiraAccountInfo {
  accountId: string;
  displayName: string;
  emailAddress: string;
}

export interface CreateJiraOAuthHandlersOptions {
  createAuth: (options: { clientId: string; redirectUri: string }) => JiraOAuth;
  getConfig: () => Promise<{
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }>;
  tokenStore: JiraTokenStore;
  exchangeCodeForTokens: (params: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }) => Promise<JiraTokenSet>;
  refreshTokens: (params: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) => Promise<RefreshedJiraTokens>;
  testConnectionWithToken: (accessToken: string, cloudId: string) => Promise<JiraAccountInfo>;
}

export class JiraOAuthHandlersError extends Error {
  status: 400 | 409 | 503;

  constructor(status: 400 | 409 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

export const createJiraOAuthHandlers = (
  options: CreateJiraOAuthHandlersOptions,
): JiraOAuthHandlers => {
  const sessions = new Map<
    string,
    {
      auth: JiraOAuth;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    }
  >();

  const getEnabledConfig = async (): Promise<{
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }> => {
    const config = await options.getConfig();
    if (!config.enabled) {
      throw new JiraOAuthHandlersError(
        503,
        "Jira OAuth is not configured. Set jira_client_id, jira_client_secret, and jira_callback_url in Settings or via the CLI.",
      );
    }
    return {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    };
  };

  return {
    connect: async () => {
      const config = await getEnabledConfig();
      const auth = options.createAuth({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
      });
      const request = auth.createAuthorizationRequest();
      sessions.set(request.state, {
        auth,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
      });
      return { authorizeUrl: request.url.toString() };
    },

    callback: async (params: JiraCallbackParams) => {
      const state = params.state ?? "";
      const session = sessions.get(state);
      if (!session) {
        throw new JiraOAuthHandlersError(400, "Invalid Jira OAuth state");
      }

      const { code } = session.auth.validateCallback(params);
      sessions.delete(state);

      const tokens = await options.exchangeCodeForTokens({
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        code,
        redirectUri: session.redirectUri,
      });
      await options.tokenStore.save(tokens);

      return { connected: true };
    },

    getStatus: async () => options.tokenStore.getStatus(),

    unlock: async () => {
      await options.tokenStore.unlock();
    },

    disconnect: async () => {
      await options.tokenStore.disconnect();
    },

    testConnection: async () => {
      const config = await getEnabledConfig();
      const tokens = await readFreshJiraTokenSet({
        tokenStore: options.tokenStore,
        getCredentials: () => ({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
        }),
        refreshTokens: options.refreshTokens,
      }).catch((error) => {
        if (error instanceof Error && error.message === "Jira token store is locked") {
          throw new JiraOAuthHandlersError(409, error.message);
        }
        throw error;
      });

      const account = await options.testConnectionWithToken(tokens.accessToken, tokens.cloudId);

      return {
        ok: account.accountId.length > 0 || account.displayName.length > 0,
        siteName: tokens.siteName,
        siteUrl: tokens.siteUrl,
        accountId: account.accountId,
        accountDisplayName: account.displayName,
        accountEmail: account.emailAddress,
      };
    },
  };
};
