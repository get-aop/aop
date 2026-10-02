import { z } from "zod";

/**
 * Artifacts: documents an agent makes for the person (a plan, a JSON report, a diagram, a small
 * HTML page), kept in the project's Library with their versions and shown in the artifact view.
 * See docs/ARTIFACTS.md.
 */

export const ARTIFACT_KINDS = [
  "markdown",
  "json",
  "code",
  "csv",
  "mermaid",
  "html",
  "svg",
  "image",
  "pdf",
  "text",
] as const;
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

/** The kinds whose bytes are text: they can be copied, diffed and written by an agent as `content`. */
export const TEXT_ARTIFACT_KINDS: ReadonlySet<ArtifactKind> = new Set([
  "markdown",
  "json",
  "code",
  "csv",
  "mermaid",
  "html",
  "svg",
  "text",
]);

export const ARTIFACT_LIMITS = {
  titleMaxLength: 120,
  noteMaxLength: 300,
  languageMaxLength: 40,
} as const;

/** The extension a kind's file gets in the Library when the agent names none. */
export const ARTIFACT_EXTENSIONS: Record<ArtifactKind, string> = {
  markdown: "md",
  json: "json",
  code: "txt",
  csv: "csv",
  mermaid: "mmd",
  html: "html",
  svg: "svg",
  image: "png",
  pdf: "pdf",
  text: "txt",
};

const CODE_EXTENSIONS: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  java: "java",
  js: "javascript",
  jsx: "jsx",
  kt: "kotlin",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
  diff: "diff",
  patch: "diff",
};

const KIND_BY_EXTENSION: Record<string, ArtifactKind> = {
  md: "markdown",
  markdown: "markdown",
  json: "json",
  csv: "csv",
  tsv: "csv",
  mmd: "mermaid",
  mermaid: "mermaid",
  html: "html",
  htm: "html",
  svg: "svg",
  pdf: "pdf",
  txt: "text",
  log: "text",
};

export const extensionOf = (name: string): string =>
  name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";

/** What a file is shown as, from its name first and its MIME type after. */
export const artifactKindOf = (name: string, mimeType: string): ArtifactKind => {
  const extension = extensionOf(name);
  const byExtension = KIND_BY_EXTENSION[extension];
  if (byExtension) return byExtension;
  if (CODE_EXTENSIONS[extension]) return "code";
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/json") return "json";
  if (mimeType === "text/markdown") return "markdown";
  if (mimeType === "text/csv") return "csv";
  if (mimeType === "text/html") return "html";
  return "text";
};

/** The highlighter's language for a code file, from its extension; null when unknown. */
export const codeLanguageOf = (name: string): string | null =>
  CODE_EXTENSIONS[extensionOf(name)] ?? null;

/**
 * An artifact a turn created or updated, where the turn did it: the chat draws it as a card that
 * opens the artifact view. It carries what the card shows, so history renders without a lookup;
 * the view reads the artifact itself.
 */
export const ArtifactPartSchema = z.object({
  type: z.literal("artifact"),
  /** The tool call that made it; the card stands in for that call's row. */
  toolId: z.string().min(1).max(200),
  artifactId: z.string().min(1).max(200),
  version: z.number().int().positive(),
  title: z.string().min(1).max(ARTIFACT_LIMITS.titleMaxLength),
  kind: ArtifactKindSchema,
  action: z.enum(["created", "updated"]),
});
export type ArtifactPart = z.infer<typeof ArtifactPartSchema>;

/** What an artifact tool tells the chat it made, on one line of its result after this prefix. */
export const ARTIFACT_RESULT_MARKER = "aop-artifact: ";

export type ArtifactResultRef = Omit<ArtifactPart, "type" | "toolId">;

export const formatArtifactMarker = (ref: ArtifactResultRef): string =>
  `${ARTIFACT_RESULT_MARKER}${JSON.stringify(ref)}`;

/** The artifact a tool result's text names, or null when it names none or names it wrongly. */
export const parseArtifactMarker = (text: string): ArtifactResultRef | null => {
  const line = text
    .split("\n")
    .findLast((candidate) => candidate.startsWith(ARTIFACT_RESULT_MARKER));
  if (!line) return null;
  try {
    const parsed = ArtifactPartSchema.omit({ type: true, toolId: true }).safeParse(
      JSON.parse(line.slice(ARTIFACT_RESULT_MARKER.length)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const ArtifactVersionSchema = z.object({
  version: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  kind: ArtifactKindSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
  /** The chat message whose turn wrote it, when a turn did. */
  messageId: z.string().nullable(),
});
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

/**
 * One artifact as the view shows it. A Library file that is not an artifact (an upload, a file an
 * agent saved with `aop_library_save`) reads the same, as one version and `versioned: false`.
 */
export const ArtifactDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: ArtifactKindSchema,
  /** The highlighter's language for `code`. */
  language: z.string().nullable(),
  /** The Library file: its name and folder. */
  name: z.string(),
  folder: z.string(),
  currentVersion: z.number().int().positive(),
  /** Oldest first. */
  versions: z.array(ArtifactVersionSchema),
  versioned: z.boolean(),
  /** The reply a diagram was made from (Visualize). */
  originMessageId: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetailSchema>;

/** The diagrams Visualize can make; `auto` lets the model choose and `table` is a Markdown table. */
export const VISUALIZE_TYPES = [
  "auto",
  "flowchart",
  "sequence",
  "mindmap",
  "timeline",
  "table",
] as const;
export const VisualizeTypeSchema = z.enum(VISUALIZE_TYPES);
export type VisualizeType = z.infer<typeof VisualizeTypeSchema>;

export const VISUALIZE_LIMITS = {
  /** What of a reply goes to the model: enough for a long answer, never a whole transcript. */
  replyMaxChars: 16_000,
  sourceMaxChars: 20_000,
  errorMaxChars: 2_000,
} as const;

/** A diagram the host drew, not yet checked: the browser parses Mermaid before it is saved. */
export const VisualizeCandidateSchema = z.object({
  kind: z.enum(["mermaid", "markdown"]),
  source: z.string(),
});
export type VisualizeCandidate = z.infer<typeof VisualizeCandidateSchema>;

export const VisualizeGenerateInputSchema = z.object({
  messageId: z.string().min(1),
  type: VisualizeTypeSchema,
});
export type VisualizeGenerateInput = z.infer<typeof VisualizeGenerateInputSchema>;

export const VisualizeRepairInputSchema = VisualizeGenerateInputSchema.extend({
  source: z.string().min(1).max(VISUALIZE_LIMITS.sourceMaxChars),
  error: z.string().max(VISUALIZE_LIMITS.errorMaxChars),
});
export type VisualizeRepairInput = z.infer<typeof VisualizeRepairInputSchema>;

/** Saves the diagram as the message's artifact: a checked candidate, or the outline fallback. */
export const VisualizeSaveInputSchema = z.discriminatedUnion("result", [
  VisualizeGenerateInputSchema.extend({
    result: z.literal("diagram"),
    candidate: VisualizeCandidateSchema.extend({
      source: z.string().min(1).max(VISUALIZE_LIMITS.sourceMaxChars),
    }),
  }),
  VisualizeGenerateInputSchema.extend({ result: z.literal("outline") }),
]);
export type VisualizeSaveInput = z.infer<typeof VisualizeSaveInputSchema>;
