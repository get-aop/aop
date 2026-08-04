import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { GitHubAppStatus, GitHubAssignedPullRequest } from "./types.ts";

interface GitHubRoutesModule {
  createGitHubRoutes(deps: {
    getStatus(): Promise<GitHubAppStatus>;
    handleCallback(params: {
      installationId?: string | null;
      setupAction?: string | null;
      accountLogin?: string | null;
      userLogin?: string | null;
    }): Promise<GitHubAppStatus>;
    syncAssignedPullRequests(params: { userLogin?: string }): Promise<GitHubAssignedPullRequest[]>;
  }): Hono;
}

const loadRoutesModule = async (): Promise<GitHubRoutesModule> =>
  (await import("./routes.ts")) as GitHubRoutesModule;

describe("integrations/github/routes", () => {
  test("GET /status returns GitHub App installation state", async () => {
    const { createGitHubRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/github",
      createGitHubRoutes({
        getStatus: async () => ({
          configured: true,
          connected: true,
          installationId: "12345",
          accountLogin: "get-aop",
          userLogin: "alex-demo",
        }),
        handleCallback: async () => {
          throw new Error("should not handle callback");
        },
        syncAssignedPullRequests: async () => [],
      }),
    );

    const res = await app.request("/api/github/status");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      configured: true,
      connected: true,
      installationId: "12345",
      accountLogin: "get-aop",
      userLogin: "alex-demo",
    });
  });

  test("GET /app/callback stores the installation id without exposing credentials", async () => {
    const { createGitHubRoutes } = await loadRoutesModule();
    const app = new Hono();
    let seenParams: unknown;

    app.route(
      "/api/github",
      createGitHubRoutes({
        getStatus: async () => ({ configured: false, connected: false }),
        handleCallback: async (params) => {
          seenParams = params;
          return {
            configured: true,
            connected: true,
            installationId: "98765",
            accountLogin: "get-aop",
            userLogin: "alex-demo",
          };
        },
        syncAssignedPullRequests: async () => [],
      }),
    );

    const res = await app.request(
      "/api/github/app/callback?installation_id=98765&setup_action=install&account_login=get-aop&user_login=alex-demo",
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(seenParams).toEqual({
      installationId: "98765",
      setupAction: "install",
      accountLogin: "get-aop",
      userLogin: "alex-demo",
    });
    expect(body).toEqual({
      ok: true,
      status: {
        configured: true,
        connected: true,
        installationId: "98765",
        accountLogin: "get-aop",
        userLogin: "alex-demo",
      },
    });
  });

  test("GET /assigned-prs returns read-only assigned PR summaries", async () => {
    const { createGitHubRoutes } = await loadRoutesModule();
    const app = new Hono();
    let seenParams: unknown;

    app.route(
      "/api/github",
      createGitHubRoutes({
        getStatus: async () => ({ configured: true, connected: true }),
        handleCallback: async () => ({ configured: true, connected: true }),
        syncAssignedPullRequests: async (params) => {
          seenParams = params;
          return [
            {
              id: "pr_1",
              repo: "get-aop/aop-mono",
              number: 55,
              title: "Fix demo rehearsal",
              state: "open",
              url: "https://github.com/get-aop/aop-mono/pull/55",
              author: "alex-demo",
              reviewContext: "Assigned to alex-demo",
              updatedAt: "2026-05-15T21:00:00.000Z",
            },
          ];
        },
      }),
    );

    const res = await app.request("/api/github/assigned-prs?userLogin=alex-demo");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(seenParams).toEqual({ userLogin: "alex-demo" });
    expect(body).toEqual({
      pullRequests: [
        {
          id: "pr_1",
          repo: "get-aop/aop-mono",
          number: 55,
          title: "Fix demo rehearsal",
          state: "open",
          url: "https://github.com/get-aop/aop-mono/pull/55",
          author: "alex-demo",
          reviewContext: "Assigned to alex-demo",
          updatedAt: "2026-05-15T21:00:00.000Z",
        },
      ],
    });
  });

  test("GET /assigned-prs returns actionable sync errors", async () => {
    const { createGitHubRoutes } = await loadRoutesModule();
    const app = new Hono();

    app.route(
      "/api/github",
      createGitHubRoutes({
        getStatus: async () => ({ configured: false, connected: false }),
        handleCallback: async () => ({ configured: false, connected: false }),
        syncAssignedPullRequests: async () => {
          throw new Error("GitHub App installation is not connected");
        },
      }),
    );

    const res = await app.request("/api/github/assigned-prs");
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({ error: "GitHub App installation is not connected" });
  });
});
