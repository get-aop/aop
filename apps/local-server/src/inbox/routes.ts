import {
  InboxDispatchInputSchema,
  InboxLinkInputSchema,
  InboxLinkPatchSchema,
  InboxReplyInputSchema,
  InboxStateInputSchema,
  InboxViewSchema,
} from "@aop/common";
import { Hono } from "hono";
import { readBody } from "../project/http.ts";
import type { HostInbox } from "./host-inbox.ts";
import { inboxError } from "./route-errors.ts";
import { addSourceRoutes } from "./routes-sources.ts";

/**
 * The Inbox's API, under `/api/inbox`. Any authenticated client may use it (decision D3 of the
 * Slack Inbox design): the person reads, triages, replies and dispatches from paired devices too.
 */
export const createInboxRoutes = (host: HostInbox) => {
  const { inbox, actions, dispatch } = host;
  const routes = new Hono();

  routes.get("/summary", async (c) => c.json(await actions.summary()));

  routes.get("/items", async (c) => {
    const view = InboxViewSchema.safeParse(c.req.query("view") ?? "needs-me");
    if (!view.success) return c.json({ error: "Unknown view", code: "INVALID_INPUT" }, 400);
    const limit = c.req.query("limit");
    const result = await actions.list(view.data, {
      cursor: c.req.query("cursor") || undefined,
      limit: limit ? Number.parseInt(limit, 10) || undefined : undefined,
      projectId: c.req.query("project") || undefined,
    });
    return result.success ? c.json(result.page) : inboxError(c, result.error);
  });

  routes.get("/items/:id", async (c) => {
    const result = await inbox.get(c.req.param("id"));
    return result.success ? c.json({ item: result.item }) : inboxError(c, result.error);
  });

  routes.get("/items/:id/context", async (c) => {
    const result = await actions.context(c.req.param("id"), c.req.query("all") === "1");
    return result.success ? c.json({ context: result.context }) : inboxError(c, result.error);
  });

  routes.post("/items/:id/reply", async (c) => {
    const parsed = await readBody(c, InboxReplyInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await actions.reply(c.req.param("id"), parsed.body);
    return result.success
      ? c.json({ message: result.message, item: result.item }, 201)
      : inboxError(c, result.error);
  });

  routes.get("/items/:id/dispatch", async (c) => {
    const result = await dispatch.draft(c.req.param("id"));
    return result.success ? c.json({ draft: result.draft }) : inboxError(c, result.error);
  });

  routes.post("/items/:id/dispatch", async (c) => {
    const parsed = await readBody(c, InboxDispatchInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await dispatch.dispatch(c.req.param("id"), parsed.body);
    return result.success
      ? c.json({ item: result.item, threadId: result.threadId }, 201)
      : inboxError(c, result.error);
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

  routes.patch("/items/:id/links/:linkId", async (c) => {
    const parsed = await readBody(c, InboxLinkPatchSchema);
    if ("response" in parsed) return parsed.response;
    const result = await inbox.setPostBack(
      c.req.param("id"),
      c.req.param("linkId"),
      parsed.body.postBack,
    );
    return result.success ? c.json({ item: result.item }) : inboxError(c, result.error);
  });

  routes.delete("/items/:id/links/:linkId", async (c) => {
    const result = await inbox.removeLink(c.req.param("id"), c.req.param("linkId"));
    return result.success ? c.json({ item: result.item }) : inboxError(c, result.error);
  });

  addSourceRoutes(routes, host);
  return routes;
};
