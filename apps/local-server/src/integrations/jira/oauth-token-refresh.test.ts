import { describe, expect, mock, test } from "bun:test";
import { readFreshJiraTokenSet, refreshJiraTokens } from "./oauth-token-refresh.ts";
import type { JiraTokenSet, JiraTokenStore } from "./oauth-types.ts";

const buildTokenStore = (overrides: Partial<JiraTokenStore>): JiraTokenStore => ({
  save: async () => {},
  getStatus: async () => ({ connected: true, locked: false }),
  unlock: async () => {},
  read: async () => {
    throw new Error("not implemented");
  },
  lock: async () => {},
  disconnect: async () => {},
  ...overrides,
});

describe("integrations/jira/oauth-token-refresh", () => {
  test("posts the refresh grant as JSON with the client secret", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });
      return Response.json({
        access_token: "fresh-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
      });
    });

    const result = await refreshJiraTokens(
      {
        clientId: "jira-client-id",
        clientSecret: "jira-client-secret",
        refreshToken: "old-refresh",
      },
      { fetch: fetchMock as unknown as typeof fetch, now: () => new Date(0) },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://auth.atlassian.com/oauth/token");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      grant_type: "refresh_token",
      client_id: "jira-client-id",
      client_secret: "jira-client-secret",
      refresh_token: "old-refresh",
    });
    expect(result).toEqual({
      accessToken: "fresh-access",
      refreshToken: "rotated-refresh",
      expiresAt: new Date(3600 * 1000).toISOString(),
    });
  });

  test("throws a descriptive error when the refresh request fails", async () => {
    const fetchMock = mock(async () => new Response("bad token", { status: 401 }));

    await expect(
      refreshJiraTokens(
        { clientId: "id", clientSecret: "secret", refreshToken: "old" },
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow("Jira OAuth token refresh failed (401): bad token");
  });

  test("returns stored tokens unchanged when they are still fresh", async () => {
    const storedTokens: JiraTokenSet = {
      accessToken: "current-access",
      refreshToken: "current-refresh",
      expiresAt: "2999-01-01T00:00:00.000Z",
      cloudId: "cloud-123",
      siteUrl: "https://acme.atlassian.net",
      siteName: "Acme",
    };
    const refreshTokens = mock(async () => ({
      accessToken: "x",
      refreshToken: "y",
      expiresAt: "z",
    }));

    const result = await readFreshJiraTokenSet({
      tokenStore: buildTokenStore({ read: async () => storedTokens }),
      getCredentials: () => ({ clientId: "id", clientSecret: "secret" }),
      refreshTokens,
    });

    expect(result).toEqual(storedTokens);
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  test("rotates the refresh token and merges the stored site info on refresh", async () => {
    const storedTokens: JiraTokenSet = {
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

    const result = await readFreshJiraTokenSet({
      tokenStore: buildTokenStore({ read: async () => storedTokens, save }),
      getCredentials: () => ({ clientId: "jira-client-id", clientSecret: "jira-client-secret" }),
      refreshTokens,
    });

    expect(refreshTokens).toHaveBeenCalledWith({
      clientId: "jira-client-id",
      clientSecret: "jira-client-secret",
      refreshToken: "expired-refresh",
    });
    const expected: JiraTokenSet = {
      accessToken: "fresh-access",
      refreshToken: "rotated-refresh",
      expiresAt: "2999-01-01T00:00:00.000Z",
      cloudId: "cloud-123",
      siteUrl: "https://acme.atlassian.net",
      siteName: "Acme",
    };
    expect(result).toEqual(expected);
    expect(save).toHaveBeenCalledWith(expected);
  });
});
