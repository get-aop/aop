import { LIBRARY_LIMITS, type LibraryItem } from "@aop/common";
import { z } from "zod";
import type { LibraryError } from "../library/service.ts";
import { defineTool, type McpToolCall, McpToolError, textResult } from "./registry.ts";

/** The project's Library, for the coordinator and every thread: save files for the person, read what they added. */

const MB = 1024 * 1024;

const projectIdOf = ({ session }: McpToolCall): string => {
  if (!session.project_id) {
    throw new McpToolError("This session belongs to no project", "NO_PROJECT");
  }
  return session.project_id;
};

export const librarySaveTool = defineTool({
  name: "aop_library_save",
  description: `Save a file to the project's Library, where the person finds, previews and downloads it: reports, docs, diagrams, exports, screenshots. Give either \`path\` (a file in your workspace, up to ${LIBRARY_LIMITS.artifactMaxBytes / MB} MB) or \`content\` (text you wrote, with a \`name\` such as report.md). Saving the same file under the same name and folder again returns the item already there. Saved files are removed after the project's retention period unless the person pins them.`,
  input: z
    .object({
      path: z
        .string()
        .min(1)
        .optional()
        .describe("A file inside your workspace, relative to it or absolute."),
      content: z.string().optional().describe("The file's text, when it is not on disk."),
      name: z
        .string()
        .max(LIBRARY_LIMITS.nameMaxLength)
        .optional()
        .describe("The file name the person sees, with its extension. Defaults to the path's."),
      folder: z
        .string()
        .max(LIBRARY_LIMITS.folderMaxDepth * (LIBRARY_LIMITS.folderSegmentMaxLength + 1))
        .optional()
        .describe('A folder such as "Reports" or "Reports/Q3". Defaults to "Artifacts".'),
      description: z
        .string()
        .max(LIBRARY_LIMITS.descriptionMaxLength)
        .optional()
        .describe("One line on what the file is."),
    })
    .refine((input) => (input.path === undefined) !== (input.content === undefined), {
      error: "Give exactly one of `path` or `content`",
    }),
  handler: async (args, call) => {
    const saved = await call.services.library.saveFromAgent(call.session, args);
    if (!saved.success) throw new McpToolError(describeLibraryError(saved.error), saved.error.code);
    return textResult({
      saved: summary(saved.item),
      note: "The person sees it in the project's Library tab.",
    });
  },
});

export const libraryListTool = defineTool({
  name: "aop_library_list",
  description:
    "List the files in the project's Library: what agents saved, what the person sent in chat, and documents they uploaded. Read a text file with aop_library_read.",
  input: z.object({
    folder: z.string().optional().describe("Only this folder and the folders inside it."),
  }),
  handler: async (args, call) => {
    const listed = await call.services.library.list(projectIdOf(call));
    if (!listed.success) {
      throw new McpToolError(describeLibraryError(listed.error), listed.error.code);
    }
    const folder = args.folder?.replace(/^\/+|\/+$/g, "");
    const items = listed.listing.items.filter(
      (item) => !folder || item.folder === folder || item.folder.startsWith(`${folder}/`),
    );
    return textResult({ items: items.map(summary) });
  },
});

export const libraryReadTool = defineTool({
  name: "aop_library_read",
  description: `Read a text file from the project's Library by its id (from aop_library_list). Only text files; at most ${LIBRARY_LIMITS.readMaxBytes / 1024} KB is returned.`,
  input: z.object({ id: z.string().min(1).describe("The item's id.") }),
  handler: async (args, call) => {
    const read = await call.services.library.readText(projectIdOf(call), args.id);
    if (!read.success) throw new McpToolError(describeLibraryError(read.error), read.error.code);
    return textResult({ item: summary(read.item), truncated: read.truncated, text: read.text });
  },
});

const summary = (item: LibraryItem) => ({
  id: item.id,
  name: item.name,
  folder: item.folder,
  description: item.description || undefined,
  source: item.source,
  mimeType: item.mimeType,
  size: item.size,
  pinned: item.pinned,
  expiresAt: item.expiresAt,
});

export const describeLibraryError = (error: LibraryError): string => {
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
      return "This session's project no longer exists";
    case "ITEM_NOT_FOUND":
      return "No such file in the Library";
    case "INVALID_NAME":
      return `Use a file name of 1 to ${LIBRARY_LIMITS.nameMaxLength} characters, without / or \\`;
    case "INVALID_FOLDER":
      return `Use a folder path of at most ${LIBRARY_LIMITS.folderMaxDepth} levels of ${LIBRARY_LIMITS.folderSegmentMaxLength} characters`;
    case "INVALID_INPUT":
      return error.message;
    case "EMPTY_FILE":
      return "The file is empty";
    case "FILE_TOO_LARGE":
      return `Files must be ${error.maxBytes / MB} MB or smaller`;
    case "LIBRARY_FULL":
      return "The Library is full of files the person pinned or uploaded; tell them, and do not retry";
    case "NOT_TEXT":
      return "That file is not text; tell the person to open it in the Library";
    case "NO_WORKSPACE":
      return "This session has no workspace to read files from; pass `content` instead";
    case "PATH_NOT_FOUND":
      return `No file at ${error.path}`;
    case "PATH_OUTSIDE_WORKSPACE":
      return `${error.path} is outside your workspace; only files inside it can be saved`;
    case "NOT_A_FILE":
      return `${error.path} is not a file`;
  }
};
