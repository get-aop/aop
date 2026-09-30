import type { Context } from "hono";
import type { ZodSchema } from "zod";
import { describeServiceError, type ServiceError } from "./errors.ts";

/** Parses the JSON body against a schema, or answers 400 with the issues. */
export const readBody = async <T>(
  c: Context,
  schema: ZodSchema<T>,
): Promise<{ body: T } | { response: Response }> => {
  const raw: unknown = await c.req.json().catch(() => undefined);
  if (raw === undefined) return { response: c.json({ error: "Invalid JSON", details: [] }, 400) };
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { body: parsed.data }
    : { response: c.json({ error: "Invalid request", details: parsed.error.issues }, 400) };
};

/** The one place a service error becomes an HTTP status: not found 404, a refused state 409, bad input 400. */
export const errorResponse = (c: Context, error: ServiceError): Response => {
  const body = { error: describeServiceError(error), code: error.code };
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
    case "THREAD_NOT_FOUND":
    case "MEMORY_FILE_NOT_FOUND":
    case "REPO_NOT_FOUND":
      return c.json(body, 404);
    case "INVALID_MESSAGE":
    case "REPO_REQUIRED":
    case "REPO_NOT_IN_PROJECT":
      return c.json(body, 400);
    default:
      return c.json(body, 409);
  }
};
