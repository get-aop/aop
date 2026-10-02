import { CHAT_IMAGE_LIMITS } from "@aop/common";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AttachmentError, AttachmentService } from "./service.ts";

/**
 * Mounted at /api/projects. An upload is the image's own bytes as the body, so a browser, the
 * desktop app and a host reached over the network all send it the same way; no path on the
 * client's disk is involved.
 */
export const createAttachmentRoutes = (attachments: AttachmentService) => {
  const routes = new Hono();

  routes.post(
    "/:projectId/attachments",
    bodyLimit({
      maxSize: CHAT_IMAGE_LIMITS.maxBytes,
      onError: (c) =>
        attachmentError(c, { code: "IMAGE_TOO_LARGE", maxBytes: CHAT_IMAGE_LIMITS.maxBytes }),
    }),
    async (c) => {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const result = await attachments.upload(c.req.param("projectId"), bytes);
      return result.success
        ? c.json({ image: result.image }, 201)
        : attachmentError(c, result.error);
    },
  );

  routes.get("/:projectId/images/:fileName", async (c) => {
    const result = await attachments.messageImage(
      c.req.param("projectId"),
      c.req.param("fileName"),
    );
    if (!result.success) return attachmentError(c, result.error);
    return new Response(Bun.file(result.path), {
      headers: {
        "Content-Type": result.mimeType,
        // A sent image never changes; its name is its message's.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  return routes;
};

const attachmentError = (c: Context, error: AttachmentError): Response => {
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
      return c.json({ error: "Project not found", code: error.code }, 404);
    case "IMAGE_NOT_FOUND":
      return c.json({ error: "Image not found", code: error.code }, 404);
    case "IMAGE_REMOVED":
      return c.json(
        {
          error:
            error.reason === "expired"
              ? "This file expired and was removed from the Library"
              : "This file was deleted from the Library",
          code: error.code,
          reason: error.reason,
          removedAt: error.removedAt,
        },
        410,
      );
    case "EMPTY_IMAGE":
      return c.json({ error: "The image is empty", code: error.code }, 400);
    case "UNSUPPORTED_IMAGE":
      return c.json({ error: "Use a PNG, JPEG, GIF or WebP image", code: error.code }, 415);
    case "IMAGE_TOO_LARGE":
      return c.json(
        {
          error: `Images must be ${error.maxBytes / (1024 * 1024)} MB or smaller`,
          code: error.code,
        },
        413,
      );
  }
};
