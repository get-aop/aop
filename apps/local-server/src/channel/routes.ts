import type { Context } from "hono";
import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import {
  type ChannelServiceDeps,
  createChannelService,
  type SendChannelMessageResult,
} from "./service.ts";

export const createChannelRoutes = (ctx: LocalServerContext, deps: ChannelServiceDeps = {}) => {
  const routes = new Hono();
  const service = createChannelService(ctx, deps);

  routes.get("/factory", async (c) => {
    return c.json(await service.getFactoryChannel());
  });

  routes.get("/:channelId/messages", async (c) => {
    const result = await service.listMessages(c.req.param("channelId"));
    if (!result.success) {
      return c.json({ error: "Channel not found" }, 404);
    }

    return c.json({ messages: result.messages });
  });

  routes.post("/:channelId/messages", async (c) => {
    const body = await c.req.json<{ content?: unknown }>().catch((): { content?: unknown } => ({}));
    const result = await service.sendUserMessage(c.req.param("channelId"), body.content);
    if (!result.success) {
      return mapSendMessageError(c, result);
    }

    return c.json({ message: result.message }, 201);
  });

  return routes;
};

const mapSendMessageError = (
  c: Context,
  result: Extract<SendChannelMessageResult, { success: false }>,
) => {
  switch (result.error.code) {
    case "CHANNEL_NOT_FOUND":
      return c.json({ error: "Channel not found" }, 404);
    case "INVALID_CONTENT":
      return c.json({ error: "Message content is required" }, 400);
  }
};
