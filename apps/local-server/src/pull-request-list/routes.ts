import { describeFirstIssue, PullRequestListQuerySchema } from "@aop/common";
import { type Context, Hono } from "hono";
import type { PullRequestListService } from "./service.ts";

/**
 * Mounted at /api/projects: `GET /:projectId/github/pulls`, the project's pull requests across
 * its GitHub repositories. Filters repeat for several values (`?author=a&author=b`); `involves`
 * and `refresh` are flags (`=1`). See `PullRequestListQuerySchema` for the rest.
 */
export const createPullRequestListRoutes = (service: PullRequestListService) => {
  const routes = new Hono();

  routes.get("/:projectId/github/pulls", async (c) => {
    const parsed = PullRequestListQuerySchema.safeParse(rawQuery(c));
    if (!parsed.success) {
      const error = describeFirstIssue(parsed.error.issues, "Invalid request");
      return c.json({ error, code: "INVALID_QUERY", details: parsed.error.issues }, 400);
    }
    const list = await service.list(c.req.param("projectId"), parsed.data);
    return list
      ? c.json(list)
      : c.json({ error: "Project not found", code: "PROJECT_NOT_FOUND" }, 404);
  });

  return routes;
};

const rawQuery = (c: Context) => {
  const query = c.req.query();
  return {
    state: query.state || undefined,
    author: c.req.queries("author") ?? [],
    label: c.req.queries("label") ?? [],
    assignee: c.req.queries("assignee") ?? [],
    q: query.q,
    sort: query.sort || undefined,
    involves: flag(query.involves),
    cursor: query.cursor || undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    refresh: flag(query.refresh),
  };
};

const flag = (value: string | undefined): boolean => value === "1" || value === "true";
