import { describeFirstIssue } from "@aop/common";
import type { Context } from "hono";
import { type ZodSchema, z } from "zod";
import { describeServiceError, type ServiceError } from "./errors.ts";
import { MAX_MESSAGE_PAGE_SIZE, type MessagePageRequest } from "./wire-messages.ts";

/** Parses the JSON body against a schema, or answers 400 with a sentence naming the field, and the issues. */
export const readBody = async <T>(
  c: Context,
  schema: ZodSchema<T>,
): Promise<{ body: T } | { response: Response }> => {
  const raw: unknown = await c.req.json().catch(() => undefined);
  if (raw === undefined) return { response: c.json({ error: "Invalid JSON", details: [] }, 400) };
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { body: parsed.data };
  const error = describeFirstIssue(parsed.error.issues, "Invalid request");
  return { response: c.json({ error, details: parsed.error.issues }, 400) };
};

/** Like `readBody`, for a schema whose fields are all optional: a request with no body means `{}`. */
export const readOptionalBody = async <T>(
  c: Context,
  schema: ZodSchema<T>,
): Promise<{ body: T } | { response: Response }> => {
  const text = await c.req.text();
  return text.trim() ? readBody(c, schema) : { body: schema.parse({}) };
};

const PageQuerySchema = z.object({
  before: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_MESSAGE_PAGE_SIZE).optional(),
});

/** Reads `?before=<message id>&limit=<n>` of a messages list, or answers 400 with a sentence naming what is wrong. */
export const readPageQuery = (
  c: Context,
): { page: MessagePageRequest } | { response: Response } => {
  const parsed = PageQuerySchema.safeParse(c.req.query());
  if (parsed.success) return { page: parsed.data };
  const error = describeFirstIssue(parsed.error.issues, "Invalid request");
  return { response: c.json({ error, details: parsed.error.issues }, 400) };
};

/** The one place a service error becomes an HTTP status: not found 404, a refused state 409, bad input 400. */
export const errorResponse = (c: Context, error: ServiceError): Response => {
  const body = { error: describeServiceError(error), code: error.code };
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
    case "THREAD_NOT_FOUND":
    case "SUGGESTION_NOT_FOUND":
    case "MEMORY_FILE_NOT_FOUND":
    case "REPO_NOT_FOUND":
    case "FILE_NOT_FOUND":
      return c.json(body, 404);
    case "INVALID_MESSAGE":
    case "INVALID_PATH":
    case "REPO_REQUIRED":
    case "REPO_NOT_IN_PROJECT":
      return c.json(body, 400);
    default:
      return c.json(body, 409);
  }
};
