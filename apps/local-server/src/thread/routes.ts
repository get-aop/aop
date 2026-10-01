import { Hono } from "hono";
import { z } from "zod";
import { CHAT_MID_RUN_MODES } from "../chat-session/mid-run-mode.ts";
import { errorResponse, readBody, readOptionalBody, readPageQuery } from "../project/http.ts";
import type { ProjectServices } from "../project/services.ts";

const SpawnBodySchema = z.object({
  title: z.string().optional(),
  prompt: z.string(),
  repoId: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
});
const MessageBodySchema = z.object({ text: z.string() });
/** `images` are ids of images uploaded to the thread's project, in order. */
const SteerBodySchema = MessageBodySchema.extend({
  images: z.array(z.string()).optional(),
  /** While the thread works: `steer` (the default) reaches it after its current step, `queue` after its turn. */
  midRunMode: z.enum(CHAT_MID_RUN_MODES).optional(),
});
const OpenPullRequestBodySchema = z.object({
  draft: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(10_000).optional(),
});
const MergePullRequestBodySchema = z.object({
  method: z.enum(["squash", "merge", "rebase"]).optional(),
});

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
    const query = readPageQuery(c);
    if ("response" in query) return query.response;
    const result = await threads.listMessages(c.req.param("threadId"), query.page);
    return result.success
      ? c.json({ messages: result.messages, hasMore: result.hasMore })
      : errorResponse(c, result.error);
  });

  routes.get("/threads/:threadId/diff", async (c) => {
    const result = await threads.changes(c.req.param("threadId"));
    return result.success ? c.json(result.diff) : errorResponse(c, result.error);
  });

  routes.get("/threads/:threadId/diff/file", async (c) => {
    const result = await threads.changedFile(c.req.param("threadId"), c.req.query("path") ?? "");
    return result.success ? c.json(result.file) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/messages", async (c) => {
    const parsed = await readBody(c, SteerBodySchema);
    if ("response" in parsed) return parsed.response;
    const { text, images, midRunMode } = parsed.body;
    const result = await threads.send(c.req.param("threadId"), text, undefined, {
      images,
      midRunMode,
    });
    return result.success ? c.json({ thread: result.thread }, 201) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/reply", async (c) => {
    const parsed = await readBody(c, MessageBodySchema);
    if ("response" in parsed) return parsed.response;
    const result = await threads.reply(c.req.param("threadId"), parsed.body.text);
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/resume", async (c) => {
    const result = await threads.resume(c.req.param("threadId"));
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/stop", async (c) => {
    const result = await threads.stop(c.req.param("threadId"));
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/pull-request", async (c) => {
    const parsed = await readOptionalBody(c, OpenPullRequestBodySchema);
    if ("response" in parsed) return parsed.response;
    const result = await threads.openPullRequest(c.req.param("threadId"), parsed.body);
    if (!result.success) return errorResponse(c, result.error);
    const { thread, pullRequest, created } = result;
    return c.json({ thread, pullRequest, created }, created ? 201 : 200);
  });

  routes.post("/threads/:threadId/pull-request/merge", async (c) => {
    const parsed = await readOptionalBody(c, MergePullRequestBodySchema);
    if ("response" in parsed) return parsed.response;
    const result = await threads.mergePullRequest(c.req.param("threadId"), parsed.body);
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/pull-request/sync", async (c) => {
    const result = await threads.syncPullRequest(c.req.param("threadId"));
    return result.success ? c.json({ thread: result.thread }) : errorResponse(c, result.error);
  });

  routes.post("/threads/:threadId/resolve", async (c) => {
    const result = await threads.resolve(c.req.param("threadId"));
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
