import { describe, expect, test } from "bun:test";

interface ClientModule {
  createJiraClient(options: {
    siteUrl?: string;
    email?: string;
    apiToken?: string;
    accessToken?: string;
    cloudId?: string;
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  }): {
    getIssuesByKeys(keys: string[]): Promise<Array<{ key: string; browseUrl: string }>>;
    testConnection(): Promise<{
      ok: boolean;
      siteUrl: string;
      accountId: string;
      accountDisplayName: string;
      accountEmail: string;
    }>;
  };
}

const loadClientModule = async (): Promise<ClientModule> =>
  (await import("./client.ts")) as ClientModule;

describe("integrations/jira/client", () => {
  test("fetches requested issues with configured Jira Cloud credentials", async () => {
    const { createJiraClient } = await loadClientModule();
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      const key = decodeURIComponent(url.split("/issue/")[1]?.split("?")[0] ?? "");
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });

      return Response.json({
        id: `id-${key}`,
        key,
        self: `https://acme.atlassian.net/rest/api/3/issue/id-${key}`,
        fields: {
          summary: `Issue ${key}`,
          description: null,
          priority: { id: "2", name: "High" },
          status: {
            id: "3",
            name: "In Progress",
            statusCategory: { key: "indeterminate", name: "In Progress" },
          },
          project: { id: "10000", key: "GET", name: "Get AOP" },
          issuelinks: [],
        },
      });
    };
    const client = createJiraClient({
      siteUrl: "https://acme.atlassian.net/",
      email: "dev@example.com",
      apiToken: "secret-token",
      fetch: fetchImpl,
    });

    const result = await client.getIssuesByKeys(["GET-50", "GET-51"]);

    expect(result.map((issue) => issue.key)).toEqual(["GET-50", "GET-51"]);
    expect(result[0]?.browseUrl).toBe("https://acme.atlassian.net/browse/GET-50");
    expect(requests.map((request) => request.url)).toEqual([
      "https://acme.atlassian.net/rest/api/3/issue/GET-50?fields=summary%2Cdescription%2Cpriority%2Cstatus%2Cproject%2Cteam%2Ccustomfield_10001%2Ccustomfield_10010%2Cissuelinks",
      "https://acme.atlassian.net/rest/api/3/issue/GET-51?fields=summary%2Cdescription%2Cpriority%2Cstatus%2Cproject%2Cteam%2Ccustomfield_10001%2Ccustomfield_10010%2Cissuelinks",
    ]);
    expect(requests[0]?.authorization).toBe(
      `Basic ${Buffer.from("dev@example.com:secret-token").toString("base64")}`,
    );
  });

  test("tests the configured Jira Cloud account", async () => {
    const { createJiraClient } = await loadClientModule();
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const client = createJiraClient({
      siteUrl: "https://acme.atlassian.net/",
      email: "dev@example.com",
      apiToken: "secret-token",
      fetch: async (input, init) => {
        requests.push({
          url: input.toString(),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          accountId: "acct-1",
          displayName: "Dev User",
          emailAddress: "dev@example.com",
        });
      },
    });

    const result = await client.testConnection();

    expect(result).toEqual({
      ok: true,
      siteUrl: "https://acme.atlassian.net",
      accountId: "acct-1",
      accountDisplayName: "Dev User",
      accountEmail: "dev@example.com",
    });
    expect(requests).toEqual([
      {
        url: "https://acme.atlassian.net/rest/api/3/myself",
        authorization: `Basic ${Buffer.from("dev@example.com:secret-token").toString("base64")}`,
      },
    ]);
  });

  test("omits missing Jira issues and rejects unconfigured clients", async () => {
    const { createJiraClient } = await loadClientModule();
    const client = createJiraClient({
      siteUrl: "https://acme.atlassian.net",
      email: "dev@example.com",
      apiToken: "secret-token",
      fetch: async () => new Response("not found", { status: 404 }),
    });

    await expect(client.getIssuesByKeys(["GET-404"])).resolves.toEqual([]);
    expect(() => createJiraClient({ siteUrl: "", email: "", apiToken: "" })).toThrow(
      "Jira is not configured",
    );
  });

  test("fetches issues via the OAuth ex/jira base with a Bearer token", async () => {
    const { createJiraClient } = await loadClientModule();
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const client = createJiraClient({
      siteUrl: "https://acme.atlassian.net",
      accessToken: "oauth-access-token",
      cloudId: "cloud-123",
      fetch: async (input, init) => {
        const url = input.toString();
        const key = decodeURIComponent(url.split("/issue/")[1]?.split("?")[0] ?? "");
        requests.push({
          url,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({ id: `id-${key}`, key, fields: { summary: `Issue ${key}` } });
      },
    });

    const result = await client.getIssuesByKeys(["GET-50"]);

    expect(result.map((issue) => issue.key)).toEqual(["GET-50"]);
    expect(result[0]?.browseUrl).toBe("https://acme.atlassian.net/browse/GET-50");
    expect(requests[0]?.url).toStartWith(
      "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/GET-50",
    );
    expect(requests[0]?.authorization).toBe("Bearer oauth-access-token");
  });

  test("tests the OAuth connection via the ex/jira myself endpoint", async () => {
    const { createJiraClient } = await loadClientModule();
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const client = createJiraClient({
      siteUrl: "https://acme.atlassian.net",
      accessToken: "oauth-access-token",
      cloudId: "cloud-123",
      fetch: async (input, init) => {
        requests.push({
          url: input.toString(),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({
          accountId: "acct-1",
          displayName: "Dev User",
          emailAddress: "dev@example.com",
        });
      },
    });

    const result = await client.testConnection();

    expect(result).toEqual({
      ok: true,
      siteUrl: "https://acme.atlassian.net",
      accountId: "acct-1",
      accountDisplayName: "Dev User",
      accountEmail: "dev@example.com",
    });
    expect(requests).toEqual([
      {
        url: "https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/myself",
        authorization: "Bearer oauth-access-token",
      },
    ]);
  });

  test("rejects an OAuth client missing the resolved cloud id", async () => {
    const { createJiraClient } = await loadClientModule();

    expect(() =>
      createJiraClient({ siteUrl: "https://acme.atlassian.net", accessToken: "token" }),
    ).toThrow("Jira is not configured");
  });

  test("rejects non-Jira Cloud site URLs before sending credentials", async () => {
    const { createJiraClient } = await loadClientModule();

    for (const siteUrl of [
      "http://acme.atlassian.net",
      "https://jira.example.com",
      "https://acme.atlassian.net.evil.com",
    ]) {
      expect(() =>
        createJiraClient({
          siteUrl,
          email: "dev@example.com",
          apiToken: "secret-token",
        }),
      ).toThrow("Jira site URL must be an HTTPS atlassian.net site");
    }
  });
});
