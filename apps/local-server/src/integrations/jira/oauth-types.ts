export interface JiraAuthorizationRequest {
  url: URL;
  state: string;
}

export interface JiraCallbackParams {
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
  state?: string | null;
}

export interface JiraTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  cloudId: string;
  siteUrl: string;
  siteName: string;
}

export interface JiraTokenStoreStatus {
  connected: boolean;
  locked: boolean;
}

export interface JiraOAuthConnectionInfo {
  ok: boolean;
  siteName: string;
  siteUrl: string;
  accountId: string;
  accountDisplayName: string;
  accountEmail: string;
}

export interface JiraOAuth {
  createAuthorizationRequest(): JiraAuthorizationRequest;
  validateCallback(params: JiraCallbackParams): { code: string; state: string };
}

export interface JiraTokenStore {
  save(tokens: JiraTokenSet): Promise<void>;
  getStatus(): Promise<JiraTokenStoreStatus>;
  unlock(): Promise<void>;
  read(): Promise<JiraTokenSet>;
  lock(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface JiraOAuthRoutesDeps {
  handlers: {
    connect(): Promise<{ authorizeUrl: string }> | { authorizeUrl: string };
    callback(params: JiraCallbackParams): Promise<{ connected: boolean }> | { connected: boolean };
    getStatus(): Promise<JiraTokenStoreStatus> | JiraTokenStoreStatus;
    unlock(): Promise<void>;
    disconnect(): Promise<void>;
    testConnection(): Promise<JiraOAuthConnectionInfo>;
  };
}
