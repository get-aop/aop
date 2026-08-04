import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import {
  listReviewInboxItems,
  type ReviewInboxFilters,
  type ReviewInboxSeverity,
  type ReviewInboxSource,
} from "./service.ts";

const SOURCES: readonly ReviewInboxSource[] = ["approval", "runtime_event", "scheduler", "signal"];
const SEVERITIES: readonly ReviewInboxSeverity[] = ["low", "medium", "high"];

export const createReviewInboxRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/review-inbox", async (c) => {
    const filters = parseReviewInboxFilters({
      repoId: c.req.query("repoId"),
      workerId: c.req.query("workerId"),
      source: c.req.query("source"),
      severity: c.req.query("severity"),
    });

    if (!filters) {
      return c.json({ error: "Invalid review inbox filter" }, 400);
    }

    const items = await listReviewInboxItems(ctx, filters);
    return c.json({ items });
  });

  return routes;
};

const parseReviewInboxFilters = (input: {
  repoId?: string;
  workerId?: string;
  source?: string;
  severity?: string;
}): ReviewInboxFilters | null => {
  if (input.source && !SOURCES.includes(input.source as ReviewInboxSource)) return null;
  if (input.severity && !SEVERITIES.includes(input.severity as ReviewInboxSeverity)) return null;

  return {
    ...(input.repoId ? { repoId: input.repoId } : {}),
    ...(input.workerId ? { workerId: input.workerId } : {}),
    ...(input.source ? { source: input.source as ReviewInboxSource } : {}),
    ...(input.severity ? { severity: input.severity as ReviewInboxSeverity } : {}),
  };
};
