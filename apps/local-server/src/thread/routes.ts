import { Hono } from "hono";
import { z } from "zod";
import { errorResponse, readBody } from "../project/http.ts";
import type { ProjectServices } from "../project/services.ts";

const SpawnBodySchema = z.object({
  title: z.string().optional(),
  prompt: z.string(),
  repoId: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
});
const MessageBodySchema = z.object({ text: z.string() });

/** Mounted at /api: threads are listed and started under their project, and read and steered by id. */
export const createThreadRoutes = ({ threads }: ProjectServices) => {
  const routes = new Hono();

  routes.get("/projects/:projectId/threads", async (c) => {
    const result = await threads.list(c.req.param("projectId"));
    return result.success ? c.json({ threads: result.threads }) : errorResponse(c, result.error);
  });

  routes.post("/projects/:projectId/threads", async (c) => {
    const parsed = await readBody(c, SpawnBodySchema);
    if ("response" in parsed) return parsed.response;
    const result = await threads.spawn(c.req.param("projectId"), parsed.body);
    return result.success ? c.json({ thread: result.thread }, 201) : errorResponse(c, result.error);
  });

  routes.get("/threads/:threadId", async (c) => {
    const result = await threads.get(c.req.param("threadId"));
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.get("/threads/:threadId/messages", async (c) => {
    const result = await threads.listMessages(c.req.param("threadId"));
    return result.success ? c.json({ messages: result.messages }) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/messages", async (c) => {
    const parsed = await readBody(c, MessageBodySchema);
    if ("response" in parsed) return parsed.response;
    const result = await threads.send(c.req.param("threadId"), parsed.body.text);
    return result.success ? c.json({ thread: result.thread }, 201) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/reply", async (c) => {
    const parsed = await readBody(c, MessageBodySchema);
    if ("response" in parsed) return parsed.response;
    const result = await threads.reply(c.req.param("threadId"), parsed.body.text);
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/stop", async (c) => {
    const result = await threads.stop(c.req.param("threadId"));
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/read", async (c) => {
    const result = await threads.markRead(c.req.param("threadId"));
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.delete("/threads/:threadId", async (c) => {
    const result = await threads.remove(c.req.param("threadId"));
    return result.success ? c.body(null, 204) : errorResponse(c, result.error);
  });

  return routes;
};
