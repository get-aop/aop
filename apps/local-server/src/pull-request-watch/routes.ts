import { Hono } from "hono";
import { errorResponse } from "../project/http.ts";
import type { ProjectServices } from "../project/services.ts";

/** Mounted at /api: what the watcher has done for a thread's pull request, for a person or a client to read. */
export const createPullRequestWatchRoutes = ({ pullRequestWatcher }: ProjectServices) => {
  const routes = new Hono();

  routes.get("/threads/:threadId/pull-request/watch", async (c) => {
    const result = await pullRequestWatcher.summary(c.req.param("threadId"));
    return result.success ? c.json({ watch: result.watch }) : errorResponse(c, result.error);
  });

  return routes;
};
