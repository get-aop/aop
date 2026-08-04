import { Hono } from "hono";
import type { GitHubAppStatus, GitHubAssignedPullRequest } from "./types.ts";

interface GitHubRoutesDeps {
  getStatus(): Promise<GitHubAppStatus>;
  handleCallback(params: {
    installationId?: string | null;
    setupAction?: string | null;
    accountLogin?: string | null;
    userLogin?: string | null;
  }): Promise<GitHubAppStatus>;
  syncAssignedPullRequests(params: { userLogin?: string }): Promise<GitHubAssignedPullRequest[]>;
}

export const createGitHubRoutes = (deps: GitHubRoutesDeps) => {
  const routes = new Hono();

  routes.get("/status", async (c) => c.json(await deps.getStatus()));

  routes.get("/app/callback", async (c) => {
    try {
      const status = await deps.handleCallback({
        installationId: c.req.query("installation_id"),
        setupAction: c.req.query("setup_action"),
        accountLogin: c.req.query("account_login"),
        userLogin: c.req.query("user_login"),
      });
      return c.json({ ok: true, status });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  routes.get("/assigned-prs", async (c) => {
    try {
      const pullRequests = await deps.syncAssignedPullRequests({
        userLogin: c.req.query("userLogin"),
      });
      return c.json({ pullRequests });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 409);
    }
  });

  return routes;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "GitHub request failed";
