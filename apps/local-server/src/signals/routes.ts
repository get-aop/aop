import { Hono } from "hono";
import type { LocalServerContext } from "../context.ts";
import type { SignalConfidence, SignalKind, SignalProvenance } from "../db/schema.ts";
import { consumeSignalAsDraftTask, createSignal, listSignals } from "./service.ts";

const SIGNAL_KINDS: readonly SignalKind[] = [
  "follow-up",
  "regression",
  "dependency",
  "flaky-test",
  "docs-gap",
];
const PROVENANCES: readonly SignalProvenance[] = ["aop", "external", "human"];
const CONFIDENCES: readonly SignalConfidence[] = ["low", "medium", "high"];

export const createSignalRoutes = (ctx: LocalServerContext) => {
  const routes = new Hono();

  routes.get("/signals", async (c) => {
    const signals = await listSignals(ctx, {
      repoId: c.req.query("repoId"),
      openOnly: c.req.query("openOnly") !== "false",
    });
    return c.json({ signals });
  });

  routes.post("/signals", async (c) => {
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const input = parseCreateSignalBody(body);
    if (!input) return c.json({ error: "Invalid signal" }, 400);

    const signal = await createSignal(ctx, input);
    return c.json({ signal }, 201);
  });

  routes.post("/signals/:signalId/consume", async (c) => {
    const result = await consumeSignalAsDraftTask(ctx, c.req.param("signalId"));
    if (!result.success) {
      switch (result.error.code) {
        case "NOT_FOUND":
          return c.json({ error: "Signal not found" }, 404);
        case "ALREADY_CONSUMED":
          return c.json({ error: "Signal already consumed" }, 409);
        case "REPO_NOT_FOUND":
          return c.json({ error: "Signal repository not found" }, 404);
      }
    }

    return c.json({ signal: result.signal, task: result.task });
  });

  return routes;
};

const parseCreateSignalBody = (body: Record<string, unknown>) => {
  const repoId = parseRequiredString(body.repoId);
  const sourceTaskId = typeof body.sourceTaskId === "string" ? body.sourceTaskId : null;
  const sourceExecutionId =
    typeof body.sourceExecutionId === "string" ? body.sourceExecutionId : null;
  const kind = parseOneOf(body.kind, SIGNAL_KINDS);
  const title = parseRequiredString(body.title);
  const content = parseRequiredString(body.body);
  const provenance = parseOneOf(body.provenance, PROVENANCES);
  const confidence = parseOneOf(body.confidence, CONFIDENCES);

  if (!repoId || !kind || !title || !content || !provenance || !confidence) return null;

  return {
    repoId,
    sourceTaskId,
    sourceExecutionId,
    kind,
    title,
    body: content,
    provenance,
    confidence,
  };
};

const parseRequiredString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseOneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => {
  if (typeof value !== "string") return null;
  return allowed.includes(value as T) ? (value as T) : null;
};
