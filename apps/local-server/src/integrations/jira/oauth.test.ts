import { describe, expect, test } from "bun:test";

interface AuthorizationRequest {
  url: URL;
  state: string;
}

interface JiraOAuth {
  createAuthorizationRequest(): AuthorizationRequest;
  validateCallback(params: {
    code?: string | null;
    error?: string | null;
    errorDescription?: string | null;
    state?: string | null;
  }): { code: string; state: string };
}

interface JiraOAuthModule {
  createJiraOAuth(options: { clientId: string; redirectUri: string; scope?: string }): JiraOAuth;
}

const loadOAuthModule = async (): Promise<JiraOAuthModule> =>
  (await import("./oauth.ts")) as JiraOAuthModule;

const REDIRECT_URI = "http://127.0.0.1:4310/api/jira/oauth/callback";

describe("integrations/jira/oauth", () => {
  test("creates an Atlassian authorization URL with audience, scope, and state", async () => {
    const { createJiraOAuth } = await loadOAuthModule();
    const oauth = createJiraOAuth({
      clientId: "jira-client-id",
      redirectUri: REDIRECT_URI,
    });

    const request = oauth.createAuthorizationRequest();

    expect(request.url.origin).toBe("https://auth.atlassian.com");
    expect(request.url.pathname).toBe("/authorize");
    expect(request.url.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(request.url.searchParams.get("client_id")).toBe("jira-client-id");
    expect(request.url.searchParams.get("scope")).toBe(
      "read:jira-work read:jira-user offline_access",
    );
    expect(request.url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(request.url.searchParams.get("response_type")).toBe("code");
    expect(request.url.searchParams.get("prompt")).toBe("consent");
    expect(request.url.searchParams.get("state")).toBe(request.state);
    expect(request.url.searchParams.has("code_challenge")).toBe(false);
    expect(request.url.searchParams.has("code_verifier")).toBe(false);
    expect(request.state.length).toBeGreaterThan(20);
  });

  test("honors a custom scope when provided", async () => {
    const { createJiraOAuth } = await loadOAuthModule();
    const oauth = createJiraOAuth({
      clientId: "jira-client-id",
      redirectUri: REDIRECT_URI,
      scope: "read:jira-work offline_access",
    });

    const request = oauth.createAuthorizationRequest();

    expect(request.url.searchParams.get("scope")).toBe("read:jira-work offline_access");
  });

  test("accepts a valid callback and returns the authorization code", async () => {
    const { createJiraOAuth } = await loadOAuthModule();
    const oauth = createJiraOAuth({ clientId: "jira-client-id", redirectUri: REDIRECT_URI });

    const request = oauth.createAuthorizationRequest();
    const result = oauth.validateCallback({ code: "oauth-code", state: request.state });

    expect(result).toEqual({ code: "oauth-code", state: request.state });
  });

  test("rejects callbacks with an unknown state", async () => {
    const { createJiraOAuth } = await loadOAuthModule();
    const oauth = createJiraOAuth({ clientId: "jira-client-id", redirectUri: REDIRECT_URI });

    oauth.createAuthorizationRequest();

    expect(() => oauth.validateCallback({ code: "oauth-code", state: "wrong-state" })).toThrow(
      "Invalid Jira OAuth state",
    );
  });

  test("rejects a state that was already consumed", async () => {
    const { createJiraOAuth } = await loadOAuthModule();
    const oauth = createJiraOAuth({ clientId: "jira-client-id", redirectUri: REDIRECT_URI });

    const request = oauth.createAuthorizationRequest();
    oauth.validateCallback({ code: "oauth-code", state: request.state });

    expect(() => oauth.validateCallback({ code: "oauth-code", state: request.state })).toThrow(
      "Invalid Jira OAuth state",
    );
  });

  test("surfaces callback errors from Atlassian", async () => {
    const { createJiraOAuth } = await loadOAuthModule();
    const oauth = createJiraOAuth({ clientId: "jira-client-id", redirectUri: REDIRECT_URI });

    const request = oauth.createAuthorizationRequest();

    expect(() =>
      oauth.validateCallback({
        error: "access_denied",
        errorDescription: "The user rejected the request",
        state: request.state,
      }),
    ).toThrow("Jira OAuth error: access_denied");
  });
});
