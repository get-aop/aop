import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

interface JiraRoutesModule {
  createJiraRoutes(deps: {
    getStatus(): Promise<{
      configured: boolean;
      siteUrl: string | null;
      email: string | null;
    }>;
    testConnection(): Promise<{
      ok: boolean;
      siteUrl: string;
      accountId: string;
      accountDisplayName: string;
      accountEmail: string;
    }>;
    importFromInput?(params: { cwd: string; input: string; agentId: string }): Promise<{
      repoId: string;
      alreadyExists: boolean;
      imported: Array<{
        taskId: string;
        ref: string;
        changePath: string;
        requested: boolean;
        dependencyImported: boolean;
      }>;
      failures: Array<{ ref: string; error: string }>;
    }>;
  }): Hono;
}

const loadRoutesModule = async (): Promise<JiraRoutesModule> =>
  (await import("./routes.ts")) as JiraRoutesModule;

describe("integrations/jira/routes", () => {
  test("GET /status returns Jira configuration status", async () => {
    const { createJiraRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/jira",
      createJiraRoutes({
        getStatus: async () => ({
          configured: true,
          siteUrl: "https://acme.atlassian.net",
          email: "dev@example.com",
        }),
        testConnection: async () => ({
          ok: true,
          siteUrl: "https://acme.atlassian.net",
          accountId: "acct-1",
          accountDisplayName: "Dev User",
          accountEmail: "dev@example.com",
        }),
      }),
    );

    const res = await app.request("/api/jira/status");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      configured: true,
      siteUrl: "https://acme.atlassian.net",
      email: "dev@example.com",
    });
  });

  test("POST /test-connection returns current Jira account metadata", async () => {
    const { createJiraRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/jira",
      createJiraRoutes({
        getStatus: async () => ({ configured: true, siteUrl: null, email: null }),
        testConnection: async () => ({
          ok: true,
          siteUrl: "https://acme.atlassian.net",
          accountId: "acct-1",
          accountDisplayName: "Dev User",
          accountEmail: "dev@example.com",
        }),
      }),
    );

    const res = await app.request("/api/jira/test-connection", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      siteUrl: "https://acme.atlassian.net",
      accountId: "acct-1",
      accountDisplayName: "Dev User",
      accountEmail: "dev@example.com",
    });
  });

  test("POST /import auto-registers a repo and imports Jira issues from the current cwd", async () => {
    const { createJiraRoutes } = await loadRoutesModule();
    const app = new Hono();
    let seenParams: { cwd: string; input: string; agentId: string } | undefined;

    app.route(
      "/api/jira",
      createJiraRoutes({
        getStatus: async () => ({ configured: true, siteUrl: null, email: null }),
        testConnection: async () => ({
          ok: true,
          siteUrl: "https://acme.atlassian.net",
          accountId: "acct-1",
          accountDisplayName: "Dev User",
          accountEmail: "dev@example.com",
        }),
        importFromInput: async (params) => {
          seenParams = params;
          return {
            repoId: "repo-123",
            alreadyExists: true,
            imported: [
              {
                taskId: "task-50",
                ref: "GET-50",
                changePath: "docs/tasks/get-50-jira-parity",
                requested: true,
                dependencyImported: false,
              },
            ],
            failures: [],
          };
        },
      }),
    );

    const res = await app.request("/api/jira/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: "/repo/path",
        input: "https://acme.atlassian.net/browse/GET-50",
        agentId: "agent-1",
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(seenParams).toEqual({
      cwd: "/repo/path",
      input: "https://acme.atlassian.net/browse/GET-50",
      agentId: "agent-1",
    });
    expect(body).toEqual({
      ok: true,
      repoId: "repo-123",
      alreadyExists: true,
      imported: [
        {
          taskId: "task-50",
          ref: "GET-50",
          changePath: "docs/tasks/get-50-jira-parity",
          requested: true,
          dependencyImported: false,
        },
      ],
      failures: [],
    });
  });

  test("POST /import requires cwd, input, and agentId", async () => {
    const { createJiraRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/jira",
      createJiraRoutes({
        getStatus: async () => ({ configured: false, siteUrl: null, email: null }),
        testConnection: async () => {
          throw new Error("Jira is not configured");
        },
        importFromInput: async () => {
          throw new Error("should not import");
        },
      }),
    );

    const res = await app.request("/api/jira/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: "/repo/path" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Missing required fields: cwd, input, and agentId",
    });
  });
});
