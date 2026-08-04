import { afterEach, describe, expect, mock, test } from "bun:test";
import { exchangeJiraCodeForTokens, testJiraOAuthConnection } from "./oauth-api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("integrations/jira/oauth-api", () => {
  test("exchanges the code as JSON then resolves the accessible Jira site", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url === "https://auth.atlassian.com/oauth/token") {
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      }
      return Response.json([
        {
          id: "cloud-123",
          name: "Acme",
          url: "https://acme.atlassian.net",
        },
        { id: "cloud-other", name: "Other", url: "https://other.atlassian.net" },
      ]);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await exchangeJiraCodeForTokens({
      clientId: "jira-client-id",
      clientSecret: "jira-client-secret",
      code: "oauth-code",
      redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
    });

    expect(result).toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      cloudId: "cloud-123",
      siteUrl: "https://acme.atlassian.net",
      siteName: "Acme",
    });
    expect(typeof result.expiresAt).toBe("string");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(new Headers(requests[0]?.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      grant_type: "authorization_code",
      client_id: "jira-client-id",
      client_secret: "jira-client-secret",
      code: "oauth-code",
      redirect_uri: "http://127.0.0.1:4310/api/jira/oauth/callback",
    });
    expect(requests[1]?.url).toBe("https://api.atlassian.com/oauth/token/accessible-resources");
    expect(new Headers(requests[1]?.init?.headers).get("authorization")).toBe("Bearer access");
  });

  test("throws a clear error when no accessible Jira sites are returned", async () => {
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      if (input.toString() === "https://auth.atlassian.com/oauth/token") {
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      }
      return Response.json([]);
    }) as unknown as typeof fetch;

    await expect(
      exchangeJiraCodeForTokens({
        clientId: "id",
        clientSecret: "secret",
        code: "code",
        redirectUri: "http://127.0.0.1:4310/api/jira/oauth/callback",
      }),
    ).rejects.toThrow("No accessible Jira sites for this token");
  });

  test("calls the ex/jira myself endpoint with the cloud id and bearer token", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: input.toString(),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({
        accountId: "acct-1",
        displayName: "Dev User",
        emailAddress: "dev@example.com",
      });
    }) as unknown as typeof fetch;

    const result = await testJiraOAuthConnection({
      accessToken: "oauth-access",
      cloudId: "cloud-123",
    });

    expect(requests).toEqual([
      {
        url: "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/myself",
        authorization: "Bearer oauth-access",
      },
    ]);
    expect(result).toEqual({
      accountId: "acct-1",
      displayName: "Dev User",
      emailAddress: "dev@example.com",
    });
  });
});
