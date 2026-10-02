import { RoutineInputSchema, RoutinePatchSchema, RoutineScheduleSchema } from "@aop/common";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { readBody } from "../project/http.ts";
import { describeRoutineError, type RoutineService } from "./service.ts";
import type { RoutineError } from "./types.ts";

const PreviewBodySchema = z.object({ schedule: RoutineScheduleSchema });

/**
 * Routes are thin: parse the input, call one service, answer. Writes are the host owner's
 * (auth/route-policy.ts): a routine starts work on the host by itself, unattended.
 */
export const createRoutineRoutes = (routines: RoutineService) => {
  const routes = new Hono();

  routes.get("/:projectId/routines", async (c) => {
    const result = await routines.list(c.req.param("projectId"));
    if (!result.success) return routineError(c, result.error);
    const { success: _, ...body } = result;
    return c.json(body);
  });

  routes.post("/:projectId/routines/preview", async (c) => {
    const parsed = await readBody(c, PreviewBodySchema);
    if ("response" in parsed) return parsed.response;
    return c.json(await routines.preview(parsed.body.schedule));
  });

  routes.post("/:projectId/routines", async (c) => {
    const parsed = await readBody(c, RoutineInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await routines.create(c.req.param("projectId"), parsed.body, "person");
    return result.success
      ? c.json({ routine: result.routine }, 201)
      : routineError(c, result.error);
  });

  routes.get("/:projectId/routines/:routineId", async (c) => {
    const result = await routines.get(c.req.param("projectId"), c.req.param("routineId"));
    return result.success ? c.json({ routine: result.routine }) : routineError(c, result.error);
  });

  routes.patch("/:projectId/routines/:routineId", async (c) => {
    const parsed = await readBody(c, RoutinePatchSchema);
    if ("response" in parsed) return parsed.response;
    const result = await routines.update(
      c.req.param("projectId"),
      c.req.param("routineId"),
      parsed.body,
    );
    return result.success ? c.json({ routine: result.routine }) : routineError(c, result.error);
  });

  routes.delete("/:projectId/routines/:routineId", async (c) => {
    const result = await routines.remove(c.req.param("projectId"), c.req.param("routineId"));
    return result.success ? c.body(null, 204) : routineError(c, result.error);
  });

  routes.post("/:projectId/routines/:routineId/run", async (c) => {
    const result = await routines.runNow(c.req.param("projectId"), c.req.param("routineId"));
    return result.success
      ? c.json({ routine: result.routine, run: result.run }, 201)
      : routineError(c, result.error);
  });

  routes.get("/:projectId/routines/:routineId/runs", async (c) => {
    const result = await routines.runs(c.req.param("projectId"), c.req.param("routineId"));
    return result.success ? c.json({ runs: result.runs }) : routineError(c, result.error);
  });

  return routes;
};

/** Not found 404, input the host refuses 400, a state that refuses it 409. */
const routineError = (c: Context, error: RoutineError): Response => {
  const body = { error: describeRoutineError(error), code: error.code };
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
    case "ROUTINE_NOT_FOUND":
      return c.json(body, 404);
    case "ROUTINE_TOO_FREQUENT":
    case "INVALID_ROUTINE":
    case "REPO_REQUIRED":
    case "REPO_NOT_IN_PROJECT":
      return c.json(body, 400);
    default:
      return c.json(body, 409);
  }
};
