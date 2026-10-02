import { LIBRARY_LIMITS, LibraryItemPatchSchema, LibrarySettingsSchema } from "@aop/common";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { servedContentType } from "./file-type.ts";
import type { LibraryError, LibraryService } from "./service.ts";

/**
 * Mounted at /api/projects. An upload is the file's own bytes as the body, with its name in the
 * `X-File-Name` header (URI-encoded), the same way chat images are sent. Files are served only
 * through here, behind the API's auth, and never as a page: see `servedContentType`.
 */
export const createLibraryRoutes = (library: LibraryService) => {
  const routes = new Hono();

  routes.get("/:projectId/library", async (c) => {
    const result = await library.list(c.req.param("projectId"));
    return result.success ? c.json(result.listing) : libraryError(c, result.error);
  });

  routes.post(
    "/:projectId/library",
    bodyLimit({
      maxSize: LIBRARY_LIMITS.uploadMaxBytes,
      onError: (c) =>
        libraryError(c, { code: "FILE_TOO_LARGE", maxBytes: LIBRARY_LIMITS.uploadMaxBytes }),
    }),
    async (c) => {
      const name = decodeHeader(c.req.header("X-File-Name"));
      if (name === null) return libraryError(c, { code: "INVALID_NAME" });
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const result = await library.upload(c.req.param("projectId"), {
        name,
        folder: c.req.query("folder"),
        bytes,
      });
      return result.success ? c.json({ item: result.item }, 201) : libraryError(c, result.error);
    },
  );

  routes.put("/:projectId/library/settings", async (c) => {
    const parsed = LibrarySettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return libraryError(c, { code: "INVALID_INPUT", message: "Invalid Library settings" });
    }
    const result = await library.setSettings(c.req.param("projectId"), parsed.data);
    return result.success ? c.json(result.listing) : libraryError(c, result.error);
  });

  routes.patch("/:projectId/library/items/:itemId", async (c) => {
    const parsed = LibraryItemPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return libraryError(c, { code: "INVALID_INPUT", message: "Invalid change" });
    }
    const result = await library.update(
      c.req.param("projectId"),
      c.req.param("itemId"),
      parsed.data,
    );
    return result.success ? c.json({ item: result.item }) : libraryError(c, result.error);
  });

  routes.delete("/:projectId/library/items/:itemId", async (c) => {
    const result = await library.remove(c.req.param("projectId"), c.req.param("itemId"));
    return result.success ? c.body(null, 204) : libraryError(c, result.error);
  });

  routes.get("/:projectId/library/items/:itemId/content", async (c) => {
    const result = await library.content(c.req.param("projectId"), c.req.param("itemId"));
    if (!result.success) return libraryError(c, result.error);
    const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
    return new Response(Bun.file(result.path), {
      headers: {
        "Content-Type": servedContentType(result.mimeType),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(result.name)}`,
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        // Opened directly, a file is inert: no script, no form, no frame of this origin.
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });

  return routes;
};

const decodeHeader = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export const libraryError = (c: Context, error: LibraryError): Response => {
  const [status, message] = describe(error);
  return c.json({ error: message, code: error.code }, status);
};

type ErrorStatus = 400 | 404 | 409 | 413 | 415;

const describe = (error: LibraryError): [ErrorStatus, string] => {
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
      return [404, "Project not found"];
    case "ITEM_NOT_FOUND":
      return [404, "That file is no longer in the Library"];
    case "INVALID_NAME":
      return [
        400,
        `Use a file name of 1 to ${LIBRARY_LIMITS.nameMaxLength} characters, without / or \\`,
      ];
    case "INVALID_FOLDER":
      return [400, `Use a folder path of at most ${LIBRARY_LIMITS.folderMaxDepth} levels`];
    case "INVALID_INPUT":
      return [400, error.message];
    case "EMPTY_FILE":
      return [400, "The file is empty"];
    case "FILE_TOO_LARGE":
      return [413, `Files must be ${error.maxBytes / (1024 * 1024)} MB or smaller`];
    case "LIBRARY_FULL":
      return [
        409,
        `The Library is full: pinned files and uploads use its ${error.capBytes / (1024 * 1024)} MB cap. Delete or unpin some, or raise the cap in the project's settings.`,
      ];
    case "NOT_TEXT":
      return [415, "That file is not text"];
    case "NO_WORKSPACE":
      return [400, "This session has no workspace to read from"];
    case "PATH_NOT_FOUND":
      return [404, `No file at ${error.path}`];
    case "PATH_OUTSIDE_WORKSPACE":
      return [400, `${error.path} is outside your workspace`];
    case "NOT_A_FILE":
      return [400, `${error.path} is not a file`];
  }
};
