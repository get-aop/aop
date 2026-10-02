import {
  VisualizeGenerateInputSchema,
  VisualizeRepairInputSchema,
  VisualizeSaveInputSchema,
} from "@aop/common";
import type { Context } from "hono";
import { Hono } from "hono";
import type { z } from "zod";
import { servedContentType } from "../library/file-type.ts";
import { libraryError } from "../library/routes.ts";
import type { ArtifactError, ArtifactService } from "./service.ts";
import type { VisualizeService } from "./visualize/service.ts";

/**
 * Mounted at /api/projects: the artifact view's reads, the files a reply links, and Visualize.
 * Bytes go out the way the Library sends them: never as a page (see `servedContentType`), inert
 * if opened directly. The view renders HTML and SVG itself, sandboxed.
 */
export const createArtifactRoutes = (artifacts: ArtifactService, visualize: VisualizeService) => {
  const routes = new Hono();

  routes.get("/:projectId/artifacts/:itemId", async (c) => {
    const result = await artifacts.get(c.req.param("projectId"), c.req.param("itemId"));
    return result.success ? c.json({ artifact: result.artifact }) : artifactError(c, result.error);
  });

  routes.get("/:projectId/artifacts/:itemId/versions/:version/content", async (c) => {
    const version = Number(c.req.param("version"));
    if (!Number.isSafeInteger(version) || version < 1) {
      return artifactError(c, { code: "ARTIFACT_NOT_FOUND" });
    }
    const result = await artifacts.versionContent(
      c.req.param("projectId"),
      c.req.param("itemId"),
      version,
    );
    if (!result.success) return artifactError(c, result.error);
    return fileResponse(c, Bun.file(result.path), result.mimeType, result.name);
  });

  routes.get("/:projectId/workspace-files", async (c) => {
    const result = await artifacts.workspaceFile(
      c.req.param("projectId"),
      c.req.query("sessionId") ?? "",
      c.req.query("path") ?? "",
    );
    if (!result.success) return artifactError(c, result.error);
    return fileResponse(c, result.bytes, result.mimeType, result.name);
  });

  routes.post("/:projectId/workspace-files/save", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { sessionId?: unknown; path?: unknown } | null;
    if (typeof body?.sessionId !== "string" || typeof body.path !== "string") {
      return artifactError(c, { code: "INVALID_INPUT", message: "Give a sessionId and a path" });
    }
    const result = await artifacts.saveWorkspaceFile(c.req.param("projectId"), body.sessionId, body.path);
    return result.success
      ? c.json({ artifact: result.artifact }, 201)
      : artifactError(c, result.error);
  });

  routes.get("/:projectId/visualize/:messageId", async (c) => {
    const artifact = await visualize.existing(c.req.param("projectId"), c.req.param("messageId"));
    return c.json({ artifact });
  });

  routes.post("/:projectId/visualize/generate", async (c) => {
    const input = await parse(c, VisualizeGenerateInputSchema);
    if (!input) return invalid(c);
    const result = await visualize.generate(c.req.param("projectId"), input);
    return result.success ? c.json(result.drawn) : artifactError(c, result.error);
  });

  routes.post("/:projectId/visualize/repair", async (c) => {
    const input = await parse(c, VisualizeRepairInputSchema);
    if (!input) return invalid(c);
    const result = await visualize.repair(c.req.param("projectId"), input);
    return result.success ? c.json(result.drawn) : artifactError(c, result.error);
  });

  routes.post("/:projectId/visualize/save", async (c) => {
    const input = await parse(c, VisualizeSaveInputSchema);
    if (!input) return invalid(c);
    const result = await visualize.save(c.req.param("projectId"), input);
    return result.success ? c.json({ artifact: result.artifact }) : artifactError(c, result.error);
  });

  return routes;
};

const fileResponse = (
  c: Context,
  body: Blob | Uint8Array,
  mimeType: string,
  name: string,
): Response => {
  const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
  return new Response(body, {
    headers: {
      "Content-Type": servedContentType(mimeType),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      // What the view needs to draw it; the Content-Type is deliberately inert.
      "X-Artifact-Mime-Type": mimeType,
    },
  });
};

const parse = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S> | null> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
};

const invalid = (c: Context): Response =>
  artifactError(c, { code: "INVALID_INPUT", message: "Invalid request" });

const artifactError = (c: Context, error: ArtifactError): Response => {
  switch (error.code) {
    case "ARTIFACT_NOT_FOUND":
      return c.json({ error: "That artifact is no longer in the Library", code: error.code }, 404);
    case "INVALID_TITLE":
      return c.json({ error: "Give a title of 1 to 120 characters", code: error.code }, 400);
    case "INVALID_CONTENT":
      return c.json({ error: error.message, code: error.code }, 400);
    case "MESSAGE_NOT_FOUND":
      return c.json({ error: error.message, code: error.code }, 404);
    case "VISUALIZE_FAILED":
      return c.json({ error: "The model did not return a diagram", code: error.code }, 502);
    default:
      return libraryError(c, error);
  }
};
