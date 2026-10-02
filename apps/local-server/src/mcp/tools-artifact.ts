import {
  ARTIFACT_KINDS,
  ARTIFACT_LIMITS,
  type ArtifactDetail,
  formatArtifactMarker,
  LIBRARY_LIMITS,
} from "@aop/common";
import { z } from "zod";
import type { ArtifactError, ArtifactSaved } from "../artifact/service.ts";
import { describeLibraryError } from "./tools-library.ts";
import { defineTool, McpToolError, type McpToolResult } from "./registry.ts";

/**
 * Artifacts, for the coordinator and every thread: documents made for the person that the chat
 * shows as a card where they were made, and that open in the artifact view. Each lives in the
 * project's Library and keeps its versions.
 */

const MB = 1024 * 1024;

const body = {
  content: z
    .string()
    .optional()
    .describe("The artifact's text: Markdown, JSON, CSV, Mermaid, HTML, SVG or code."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      `A file in your workspace instead of \`content\`, up to ${LIBRARY_LIMITS.artifactMaxBytes / MB} MB; images and PDFs come this way.`,
    ),
};

const exactlyOneBody = (input: { content?: string; path?: string }): boolean =>
  (input.content === undefined) !== (input.path === undefined);

const kind = z
  .enum(ARTIFACT_KINDS)
  .optional()
  .describe(
    "How the view shows it: markdown (GFM, ```mermaid fences drawn as diagrams), json (a tree), code, csv (a table), mermaid (one diagram, no fence), html (a sandboxed page with no network), svg, image, pdf or text. Inferred from the name when left out.",
  );

export const artifactCreateTool = defineTool({
  name: "aop_artifact_create",
  description: `Make an artifact: a document for the person that the chat shows as a card where you made it, which opens in a viewer beside the chat. Use it for anything they will read or reuse that is more than a few lines: a plan, a report, a table of data, a diagram, a JSON result, a small HTML page. Give a short \`title\` and either \`content\` or \`path\`. It is kept in the project's Library; change it later with aop_artifact_update and its id, and the person can compare versions.`,
  input: z
    .object({
      title: z
        .string()
        .min(1)
        .max(ARTIFACT_LIMITS.titleMaxLength)
        .describe('What the card says, such as "Release plan".'),
      ...body,
      kind,
      language: z
        .string()
        .max(ARTIFACT_LIMITS.languageMaxLength)
        .optional()
        .describe('For code: the language, such as "typescript".'),
      name: z
        .string()
        .max(LIBRARY_LIMITS.nameMaxLength)
        .optional()
        .describe("The Library file name with its extension; made from the title when left out."),
      folder: z
        .string()
        .max(LIBRARY_LIMITS.folderMaxDepth * (LIBRARY_LIMITS.folderSegmentMaxLength + 1))
        .optional()
        .describe('A Library folder. Defaults to "Artifacts".'),
    })
    .refine(exactlyOneBody, { error: "Give exactly one of `content` or `path`" }),
  handler: async (args, call) => {
    const saved = await call.services.artifacts.create(call.session, args);
    if (!saved.success) throw toolError(saved.error);
    return savedResult(saved, "Made the artifact; the person sees its card in the chat.");
  },
});

export const artifactUpdateTool = defineTool({
  name: "aop_artifact_update",
  description:
    "Save a new version of an artifact (from aop_artifact_create, or any Library file id from aop_library_list). Give the whole new `content` or a `path`, not a diff. Earlier versions stay, and the person can switch between and compare them. A card for the new version shows in the chat.",
  input: z
    .object({
      artifactId: z.string().min(1).describe("The artifact's id."),
      ...body,
      title: z.string().min(1).max(ARTIFACT_LIMITS.titleMaxLength).optional().describe("A new title."),
      kind,
      note: z
        .string()
        .max(ARTIFACT_LIMITS.noteMaxLength)
        .optional()
        .describe('What changed, in a few words, such as "Added the rollback step".'),
    })
    .refine(exactlyOneBody, { error: "Give exactly one of `content` or `path`" }),
  handler: async (args, call) => {
    const saved = await call.services.artifacts.update(call.session, args);
    if (!saved.success) throw toolError(saved.error);
    return savedResult(saved, "Saved a new version; the person sees its card in the chat.");
  },
});

// The marker line is how the chat knows to draw the card: the stream parser reads it from this
// result, where the call was made.
const savedResult = (saved: ArtifactSaved, note: string): McpToolResult => ({
  content: [
    {
      type: "text",
      text: `${JSON.stringify({ artifact: summary(saved.artifact), note }, null, 2)}\n${formatArtifactMarker(saved.ref)}`,
    },
  ],
});

const summary = (artifact: ArtifactDetail) => ({
  id: artifact.id,
  title: artifact.title,
  kind: artifact.kind,
  version: artifact.currentVersion,
  name: artifact.name,
  folder: artifact.folder,
  expiresAt: artifact.expiresAt,
});

const toolError = (error: ArtifactError): McpToolError => {
  switch (error.code) {
    case "ARTIFACT_NOT_FOUND":
      return new McpToolError("No such artifact or Library file in this project", error.code);
    case "INVALID_TITLE":
      return new McpToolError(`Give a title of 1 to ${ARTIFACT_LIMITS.titleMaxLength} characters`, error.code);
    case "INVALID_CONTENT":
    case "MESSAGE_NOT_FOUND":
      return new McpToolError(error.message, error.code);
    case "VISUALIZE_FAILED":
      return new McpToolError("Visualize failed", error.code);
    default:
      return new McpToolError(describeLibraryError(error), error.code);
  }
};
