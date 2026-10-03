import { InboxLinkInputSchema, InboxStateInputSchema, InboxViewSchema } from "@aop/common";
import { type Context, Hono } from "hono";
import { readBody } from "../project/http.ts";
import type { InboxError, InboxService } from "./service.ts";

/**
 * The Inbox's API, under `/api/inbox`. Any authenticated client may use it (decision D3 of the
 * Slack Inbox design): the person reads and triages it from paired devices too.
 */
export const createInboxRoutes = (inbox: InboxService) => {
  const routes = new Hono();

  routes.get("/summary", async (c) => c.json(await inbox.summary()));

  routes.get("/items", async (c) => {
    const view = InboxViewSchema.safeParse(c.req.query("view") ?? "needs-me");
    if (!view.success) return c.json({ error: "Unknown view", code: "INVALID_INPUT" }, 400);
    const limit = c.req.query("limit");
    const result = await inbox.list(view.data, {
      cursor: c.req.query("cursor") || undefined,
      limit: limit ? Number.parseInt(limit, 10) || undefined : undefined,
    });
    return result.success ? c.json(result.page) : inboxError(c, result.error);
  });

  routes.get("/items/:id", async (c) => {
    const result = await inbox.get(c.req.param("id"));
    return result.success ? c.json({ item: result.item }) : inboxError(c, result.error);
  });

  routes.put("/items/:id/state", async (c) => {
    const parsed = await readBody(c, InboxStateInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await inbox.setState(c.req.param("id"), parsed.body);
    return result.success ? c.json({ item: result.item }) : inboxError(c, result.error);
  });

  routes.post("/items/:id/links", async (c) => {
    const parsed = await readBody(c, InboxLinkInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await inbox.addLink(c.req.param("id"), parsed.body);
    return result.success ? c.json({ item: result.item }, 201) : inboxError(c, result.error);
  });

  routes.delete("/items/:id/links/:linkId", async (c) => {
    const result = await inbox.removeLink(c.req.param("id"), c.req.param("linkId"));
    return result.success ? c.json({ item: result.item }) : inboxError(c, result.error);
  });

  return routes;
};

const inboxError = (c: Context, error: InboxError) =>
  error.code === "NOT_FOUND"
    ? c.json({ error: "Inbox item not found", code: error.code }, 404)
    : c.json({ error: error.message, code: error.code }, 400);
