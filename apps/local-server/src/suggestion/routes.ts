import { Hono } from "hono";
import { errorResponse } from "../project/http.ts";
import type { ProjectServices } from "../project/services.ts";

const SUGGESTION = "/projects/:projectId/messages/:messageId/suggestions/:suggestionId";

/** Mounted at /api: the answers to the threads the coordinator proposes in a message. */
export const createSuggestionRoutes = ({ suggestions }: ProjectServices) => {
  const routes = new Hono();

  // 201 when this call started the thread, 200 when the suggestion had been started already.
  routes.post(`${SUGGESTION}/start`, async (c) => {
    const { projectId, messageId, suggestionId } = c.req.param();
    const result = await suggestions.start(projectId, messageId, suggestionId);
    return result.success
      ? c.json({ thread: result.thread }, result.created ? 201 : 200)
      : errorResponse(c, result.error);
  });

  routes.post(`${SUGGESTION}/skip`, async (c) => {
    const { projectId, messageId, suggestionId } = c.req.param();
    const result = await suggestions.skip(projectId, messageId, suggestionId);
    return result.success ? c.json({ answer: result.answer }) : errorResponse(c, result.error);
  });

  routes.delete(`${SUGGESTION}/skip`, async (c) => {
    const { projectId, messageId, suggestionId } = c.req.param();
    const result = await suggestions.unskip(projectId, messageId, suggestionId);
    return result.success ? c.json({ answer: result.answer }) : errorResponse(c, result.error);
  });

  return routes;
};
