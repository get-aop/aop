import { Hono } from "hono";
import type { GithubService } from "./service.ts";

/**
 * Mounted at /api/projects: a project's GitHub side, read through the host's `gh`. Any paired
 * device may read it; GitHub views of a project (pull requests, issues) add their routes beside.
 * `?fresh=1` asks `gh` about its session again instead of reusing the last minute's answer.
 */
export const createGithubRoutes = (github: GithubService) => {
  const routes = new Hono();

  routes.get("/:projectId/github/status", async (c) => {
    if (c.req.query("fresh") === "1") await github.authStatus({ fresh: true });
    const status = await github.status(c.req.param("projectId"));
    return status
      ? c.json(status)
      : c.json({ error: "Project not found", code: "PROJECT_NOT_FOUND" }, 404);
  });

  return routes;
};
