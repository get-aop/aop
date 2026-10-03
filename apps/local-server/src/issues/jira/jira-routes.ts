import { JiraConnectInputSchema, JiraTestInputSchema } from "@aop/common";
import type { Hono } from "hono";
import { readBody, readOptionalBody } from "../../project/http.ts";
import { issueErrorResponse } from "../issue-errors.ts";
import type { JiraConnectionService } from "./jira-connection-service.ts";

/**
 * A project's Jira connection, under `/api/projects/:projectId/jira`. Any client may read it;
 * setting, testing and removing it is the host owner's (auth/route-policy.ts), since the token
 * must never travel from or to a paired device. No answer carries the token.
 */
export const addJiraRoutes = (routes: Hono, jira: JiraConnectionService): void => {
  routes.get("/:projectId/jira", async (c) => {
    const result = await jira.connection(c.req.param("projectId"));
    return result.success
      ? c.json({ connection: result.connection })
      : issueErrorResponse(c, result.error);
  });

  routes.put("/:projectId/jira", async (c) => {
    const parsed = await readBody(c, JiraConnectInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await jira.connect(c.req.param("projectId"), parsed.body);
    return result.success
      ? c.json({ connection: result.connection })
      : issueErrorResponse(c, result.error);
  });

  routes.delete("/:projectId/jira", async (c) => {
    const result = await jira.disconnect(c.req.param("projectId"));
    return result.success ? c.body(null, 204) : issueErrorResponse(c, result.error);
  });

  routes.post("/:projectId/jira/test", async (c) => {
    const parsed = await readOptionalBody(c, JiraTestInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await jira.test(c.req.param("projectId"), parsed.body);
    return result.success ? c.json({ result: result.result }) : issueErrorResponse(c, result.error);
  });
};
