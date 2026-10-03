import {
  describeFirstIssue,
  IssueDetailQuerySchema,
  IssueListQuerySchema,
  LinearCatalogInputSchema,
  LinearConnectInputSchema,
  StartThreadFromIssueInputSchema,
} from "@aop/common";
import { Hono } from "hono";
import { readBody, readOptionalBody } from "../project/http.ts";
import { issueErrorResponse } from "./issue-errors.ts";
import { addJiraRoutes } from "./jira/jira-routes.ts";
import type { IssueService } from "./service.ts";

/**
 * A project's issues and its Linear and Jira connections, under `/api/projects/:projectId`. Any
 * client may list issues, read one, start a thread from one and see whether Linear or Jira is
 * connected; setting, testing and removing a key or token is the host owner's
 * (auth/route-policy.ts), and no answer carries it.
 */
export const createIssueRoutes = (issues: IssueService) => {
  const routes = new Hono();

  routes.get("/:projectId/issues", async (c) => {
    const parsed = IssueListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: describeFirstIssue(parsed.error.issues, "Invalid request") }, 400);
    }
    const result = await issues.list(c.req.param("projectId"), parsed.data);
    return result.success ? c.json(result.list) : issueErrorResponse(c, result.error);
  });

  routes.get("/:projectId/issues/detail", async (c) => {
    const parsed = IssueDetailQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: describeFirstIssue(parsed.error.issues, "Invalid request") }, 400);
    }
    const result = await issues.detail(c.req.param("projectId"), parsed.data.key);
    return result.success ? c.json({ detail: result.detail }) : issueErrorResponse(c, result.error);
  });

  routes.post("/:projectId/issues/start-thread", async (c) => {
    const parsed = await readBody(c, StartThreadFromIssueInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await issues.startThread(c.req.param("projectId"), parsed.body.key);
    return result.success
      ? c.json({ message: result.message }, 201)
      : issueErrorResponse(c, result.error);
  });

  routes.get("/:projectId/linear", async (c) => {
    const result = await issues.linearConnection(c.req.param("projectId"));
    return result.success
      ? c.json({ connection: result.connection })
      : issueErrorResponse(c, result.error);
  });

  routes.put("/:projectId/linear", async (c) => {
    const parsed = await readBody(c, LinearConnectInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await issues.connectLinear(c.req.param("projectId"), parsed.body);
    return result.success
      ? c.json({ connection: result.connection })
      : issueErrorResponse(c, result.error);
  });

  routes.delete("/:projectId/linear", async (c) => {
    const result = await issues.disconnectLinear(c.req.param("projectId"));
    return result.success ? c.body(null, 204) : issueErrorResponse(c, result.error);
  });

  routes.post("/:projectId/linear/catalog", async (c) => {
    const parsed = await readOptionalBody(c, LinearCatalogInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await issues.linearCatalog(c.req.param("projectId"), parsed.body);
    return result.success
      ? c.json({ catalog: result.catalog })
      : issueErrorResponse(c, result.error);
  });

  addJiraRoutes(routes, issues.jiraConnection);
  return routes;
};
