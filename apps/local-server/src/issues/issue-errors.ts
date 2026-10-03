import type { Context } from "hono";
import { errorResponse as projectErrorResponse } from "../project/http.ts";
import type { IssueError } from "./service.ts";

/** The one place an issues error becomes an HTTP answer, for the issues and the Jira routes. */
export const issueErrorResponse = (c: Context, error: IssueError): Response => {
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
    case "JIRA_NOT_CONFIGURED":
      return c.json({ error: "Jira is not connected to this project", code: error.code }, 409);
    case "JIRA_UNAUTHORIZED":
      return c.json(
        { error: "Jira refused the token: it may have expired or been revoked", code: error.code },
        422,
      );
    case "JIRA_BAD_FILTER":
      return c.json(
        { error: `Jira did not accept the filter: ${error.message}`, code: error.code },
        422,
      );
    case "SOURCE_FAILED":
      return c.json({ error: error.message, code: error.code }, 502);
  }
};
