import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import { createProjectStreamService } from "./stream.ts";

interface EventStreamOptions {
  heartbeatIntervalMs?: number;
}

/**
 * `GET /:projectId/stream`: everything that happens in a project, on one connection. A client
 * resumes with `?after=<last entry id>`; the browser's own reconnect sends the same as
 * `Last-Event-ID`, and when both are present the newer one wins. With neither, the stream
 * starts from now and opens with a resync.
 */
export const createEventStreamRoutes = (
  ctx: Pick<LocalServerContext, "db" | "eventPublisher">,
  options: EventStreamOptions = {},
) => {
  const service = createProjectStreamService({
    db: ctx.db,
    publisher: ctx.eventPublisher,
    ...options,
  });
  const routes = new Hono();

  routes.get("/:projectId/stream", async (c) => {
    const cursor = parseCursor(c.req.query("after"), c.req.header("last-event-id"));
    if ("error" in cursor) return c.json({ error: cursor.error }, 400);

    const stream = await service.open(c.req.param("projectId"), cursor.after);
    if (!stream) return c.json({ error: "Project not found" }, 404);
    return streamSSE(c, (sse) => stream.serve(sse));
  });

  return routes;
};

// Up to 15 digits, so the number is exact.
const EVENT_ID = /^\d{1,15}$/;

const parseCursor = (
  after: string | undefined,
  lastEventId: string | undefined,
): { after: number | null } | { error: string } => {
  const given: [name: string, value: string][] = [];
  if (after !== undefined) given.push(["after", after]);
  // A browser that has not received an id sends none; an empty header is the same thing.
  if (lastEventId) given.push(["Last-Event-ID", lastEventId]);

  const cursors: number[] = [];
  for (const [name, value] of given) {
    if (!EVENT_ID.test(value))
      return { error: `${name} must be an event id: a non-negative integer` };
    cursors.push(Number(value));
  }
  return { after: cursors.length === 0 ? null : Math.max(...cursors) };
};
