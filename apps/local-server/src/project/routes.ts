import { CreateProjectInputSchema, MemoryFileInputSchema, ProjectPatchSchema } from "@aop/common";
import { Hono } from "hono";
import { z } from "zod";
import { errorResponse, readBody, readPageQuery } from "./http.ts";
import type { ProjectAction } from "./service.ts";
import type { ProjectServices } from "./services.ts";

const MessageBodySchema = z.object({ text: z.string() });
const MemoryBodySchema = MemoryFileInputSchema.omit({ name: true });

const ACTIONS: readonly ProjectAction[] = ["pause", "resume", "archive", "restore"];

/** Routes are thin: parse the input, call one service, answer. Rules live in the services. */
export const createProjectRoutes = ({ projects, memory }: ProjectServices) => {
  const routes = new Hono();

  routes.post("/", async (c) => {
    const parsed = await readBody(c, CreateProjectInputSchema);
    if ("response" in parsed) return parsed.response;
    const { lookAround, ...settings } = parsed.body;
    const result = await projects.create(settings, { lookAround });
    return result.success
      ? c.json({ project: result.project }, 201)
      : errorResponse(c, result.error);
  });

  routes.get("/", async (c) => c.json({ projects: await projects.list() }));

  routes.get("/:projectId", async (c) => {
    const result = await projects.get(c.req.param("projectId"));
    return result.success ? c.json({ project: result.project }) : errorResponse(c, result.error);
  });

  routes.patch("/:projectId", async (c) => {
    const parsed = await readBody(c, ProjectPatchSchema);
    if ("response" in parsed) return parsed.response;
    const result = await projects.update(c.req.param("projectId"), parsed.body);
    return result.success ? c.json({ project: result.project }) : errorResponse(c, result.error);
  });

  for (const action of ACTIONS) {
    routes.post(`/:projectId/${action}`, async (c) => {
      const result = await projects.transition(c.req.param("projectId"), action);
      return result.success ? c.json({ project: result.project }) : errorResponse(c, result.error);
    });
  }

  routes.post("/:projectId/coordinator/restart", async (c) => {
    const result = await projects.restartCoordinator(c.req.param("projectId"));
    return result.success ? c.json({ project: result.project }) : errorResponse(c, result.error);
  });

  routes.delete("/:projectId", async (c) => {
    const result = await projects.remove(c.req.param("projectId"));
    return result.success ? c.body(null, 204) : errorResponse(c, result.error);
  });

  routes.get("/:projectId/messages", async (c) => {
    const query = readPageQuery(c);
    if ("response" in query) return query.response;
    const result = await projects.listMessages(c.req.param("projectId"), query.page);
    return result.success
      ? c.json({ messages: result.messages, hasMore: result.hasMore })
      : errorResponse(c, result.error);
  });

  routes.post("/:projectId/messages", async (c) => {
    const parsed = await readBody(c, MessageBodySchema);
    if ("response" in parsed) return parsed.response;
    const result = await projects.sendToCoordinator(c.req.param("projectId"), parsed.body.text);
    return result.success
      ? c.json({ message: result.message }, 201)
      : errorResponse(c, result.error);
  });

  routes.get("/:projectId/memory", async (c) => {
    const result = await memory.list(c.req.param("projectId"));
    return result.success ? c.json({ files: result.files }) : errorResponse(c, result.error);
  });

  routes.post("/:projectId/memory/requests", async (c) => {
    const parsed = await readBody(c, MessageBodySchema);
    if ("response" in parsed) return parsed.response;
    const result = await memory.requestChange(c.req.param("projectId"), parsed.body.text);
    return result.success
      ? c.json({ message: result.message }, 201)
      : errorResponse(c, result.error);
  });

  routes.get("/:projectId/memory/:name", async (c) => {
    const result = await memory.read(c.req.param("projectId"), c.req.param("name"));
    return result.success ? c.json({ file: result.file }) : errorResponse(c, result.error);
  });

  routes.put("/:projectId/memory/:name", async (c) => {
    const parsed = await readBody(c, MemoryBodySchema);
    if ("response" in parsed) return parsed.response;
    const name = c.req.param("name");
    const input = MemoryFileInputSchema.safeParse({ ...parsed.body, name });
    if (!input.success)
      return c.json({ error: "Invalid memory file name", details: input.error.issues }, 400);
    const result = await memory.write(c.req.param("projectId"), input.data);
    return result.success ? c.json({ file: result.file }) : errorResponse(c, result.error);
  });

  routes.delete("/:projectId/memory/:name", async (c) => {
    const result = await memory.remove(c.req.param("projectId"), c.req.param("name"));
    return result.success ? c.body(null, 204) : errorResponse(c, result.error);
  });

  return routes;
};
