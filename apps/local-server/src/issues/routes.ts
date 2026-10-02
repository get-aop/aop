import {
  describeFirstIssue,
  IssueListQuerySchema,
  LinearCatalogInputSchema,
  LinearConnectInputSchema,
  StartThreadFromIssueInputSchema,
} from "@aop/common";
import { type Context, Hono } from "hono";
import {
  errorResponse as projectErrorResponse,
  readBody,
  readOptionalBody,
} from "../project/http.ts";
import type { IssueError, IssueService } from "./service.ts";

/**
 * A project's issues and its Linear connection, under `/api/projects/:projectId`. Any client may
 * list issues, start a thread from one and see whether Linear is connected; setting, mapping and
 * removing the Linear key is the host owner's (auth/route-policy.ts), and no answer carries it.
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

  return routes;
};

const issueErrorResponse = (c: Context, error: IssueError): Response => {
  switch (error.code) {
    case "PROJECT_ERROR":
      return projectErrorResponse(c, error.error);
    case "PROJECT_NOT_FOUND":
      return c.json({ error: "Project not found", code: error.code }, 404);
    case "ISSUE_NOT_FOUND":
      return c.json({ error: "That issue is not one of this project's", code: error.code }, 404);
    case "LINEAR_NOT_CONFIGURED":
      return c.json({ error: "Linear is not connected to this project", code: error.code }, 409);
    case "LINEAR_UNAUTHORIZED":
      return c.json({ error: "Linear refused the API key", code: error.code }, 422);
    case "SOURCE_FAILED":
      return c.json({ error: error.message, code: error.code }, 502);
  }
};
