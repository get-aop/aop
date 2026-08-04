import { type Context, Hono } from "hono";
import type { JiraConnectionInfo } from "./types.ts";

export interface JiraImportRecord {
  taskId: string;
  ref: string;
  changePath: string;
  requested: boolean;
  dependencyImported: boolean;
}

export interface JiraImportResponse {
  repoId: string;
  alreadyExists: boolean;
  imported: JiraImportRecord[];
  failures: Array<{ ref: string; error: string }>;
}

export interface JiraStatusResponse {
  configured: boolean;
  siteUrl: string | null;
  email: string | null;
}

export interface JiraRoutesDeps {
  getStatus(): Promise<JiraStatusResponse> | JiraStatusResponse;
  testConnection(): Promise<JiraConnectionInfo> | JiraConnectionInfo;
  importFromInput?(params: {
    cwd: string;
    input: string;
    agentId: string;
  }): Promise<JiraImportResponse>;
}

export const createJiraRoutes = (deps: JiraRoutesDeps) => {
  const app = new Hono();

  app.get("/status", async (c) => {
    try {
      return c.json(await deps.getStatus());
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.post("/test-connection", async (c) => {
    try {
      return c.json(await deps.testConnection());
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  app.post("/import", async (c) => {
    if (!deps.importFromInput) {
      return c.json({ error: "Jira import is unavailable" }, 503);
    }

    const body = await c.req.json<{ cwd?: string; input?: string; agentId?: string }>();
    if (!body.cwd || !body.input || !body.agentId) {
      return c.json({ error: "Missing required fields: cwd, input, and agentId" }, 400);
    }

    try {
      const result = await deps.importFromInput({
        cwd: body.cwd,
        input: body.input,
        agentId: body.agentId,
      });
      return c.json({ ok: true, ...result });
    } catch (error) {
      return toErrorResponse(c, error);
    }
  });

  return app;
};

const toErrorResponse = (c: Context, error: unknown) => {
  const message = getErrorMessage(error);
  return c.json({ error: message }, getErrorStatus(message));
};

const getErrorStatus = (message: string): 500 | 503 =>
  message === "Jira is not configured" ? 503 : 500;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown Jira integration error";
