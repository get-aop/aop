import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import { listDirectories } from "./handlers.ts";
import { readMarkdownFile, writeMarkdownFile } from "./markdown-files.ts";

type MarkdownWriteBody = { path: string; content: string };

const isMarkdownWriteBody = (value: unknown): value is MarkdownWriteBody => {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return typeof body.path === "string" && typeof body.content === "string";
};

const markdownErrorStatus = (code: "INVALID_PATH" | "FORBIDDEN" | "TOO_LARGE"): 400 | 403 | 413 => {
  if (code === "FORBIDDEN") return 403;
  if (code === "TOO_LARGE") return 413;
  return 400;
};

const readJsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export const createFsRoutes = (ctx?: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/directories", async (c) => {
    const pathParam = c.req.query("path");
    const hidden = c.req.query("hidden") === "true";

    const result = await listDirectories(pathParam, { hidden });

    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Path not found" }, 404);
        case "NOT_A_DIRECTORY":
          return c.json({ error: "Path is not a directory" }, 400);
        case "PERMISSION_DENIED":
          return c.json({ error: "Permission denied" }, 403);
      }
    }

    return c.json(result.data);
  });

  routes.get("/markdown-file", async (c) => {
    if (!ctx) return c.json({ error: "Server context unavailable" }, 500);
    const result = await readMarkdownFile(ctx, c.req.query("path") ?? "");
    if (!result.success) {
      return c.json({ error: result.error.message }, markdownErrorStatus(result.error.code));
    }
    return c.json(result.data);
  });

  routes.put("/markdown-file", async (c) => {
    if (!ctx) return c.json({ error: "Server context unavailable" }, 500);
    const body = await readJsonBody(c.req.raw);
    if (!isMarkdownWriteBody(body)) {
      return c.json({ error: "Expected a Markdown path and string content" }, 400);
    }
    const result = await writeMarkdownFile(ctx, body.path, body.content);
    if (!result.success) {
      return c.json({ error: result.error.message }, markdownErrorStatus(result.error.code));
    }
    return c.json(result.data);
  });

  return routes;
};
