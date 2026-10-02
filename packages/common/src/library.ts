import { z } from "zod";

/**
 * A project's Library: the files its chats and agents produced or the person added. The host
 * stores them; these are the shapes its API speaks and the rules both sides check.
 *
 * - `artifact`: a file the coordinator or a thread saved for the person (aop_library_save).
 * - `chat`: an image or document the person sent in one of the project's chats.
 * - `upload`: a file the person added to the Library directly.
 */
export const LIBRARY_SOURCES = ["artifact", "chat", "upload"] as const;
export const LibrarySourceSchema = z.enum(LIBRARY_SOURCES);
export type LibrarySource = z.infer<typeof LibrarySourceSchema>;

/** Where each source lands when nobody names a folder. */
export const LIBRARY_DEFAULT_FOLDERS: Record<LibrarySource, string> = {
  artifact: "Artifacts",
  chat: "Sent in chat",
  upload: "Uploads",
};

export const LIBRARY_LIMITS = {
  /** A file the person uploads. */
  uploadMaxBytes: 50 * 1024 * 1024,
  /** A file an agent saves, by path or content. */
  artifactMaxBytes: 25 * 1024 * 1024,
  /** What `aop_library_read` hands an agent: text only, and this much of it. */
  readMaxBytes: 512 * 1024,
  nameMaxLength: 200,
  descriptionMaxLength: 1000,
  folderMaxDepth: 4,
  folderSegmentMaxLength: 80,
} as const;

/**
 * Retention defaults, chosen so the Library never grows without bound and never surprises:
 * what arrived on its own (chat attachments, agent artifacts) goes after 30 days, what the
 * person added or pinned stays, and two caps evict the least recently used automatic items.
 */
export const LIBRARY_DEFAULTS = {
  retentionDays: 30,
  projectCapMb: 1024,
  hostCapMb: 5120,
} as const;

export const LIBRARY_RETENTION_DAYS_MAX = 3650;
export const LIBRARY_CAP_MB_MAX = 1024 * 1024;

/** A stored setting as a number of days (0 keeps items forever), or null when out of range. */
export const parseLibraryRetentionDays = (value: string): number | null =>
  parseWholeNumber(value, LIBRARY_RETENTION_DAYS_MAX);

/** A stored cap in megabytes (0 means no cap), or null when out of range. */
export const parseLibraryCapMb = (value: string): number | null =>
  parseWholeNumber(value, LIBRARY_CAP_MB_MAX);

const parseWholeNumber = (value: string, max: number): number | null => {
  if (!/^\d{1,7}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed <= max ? parsed : null;
};

/** Where an item came from in a chat: a thread's (`threadId`) or the coordinator's (null). */
export const LibraryUsedInSchema = z.object({
  threadId: z.string().nullable(),
  messageId: z.string().nullable(),
});
export type LibraryUsedIn = z.infer<typeof LibraryUsedInSchema>;

export const LibraryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Slash-separated path of folders; "" is the Library's top level. */
  folder: z.string(),
  description: z.string(),
  source: LibrarySourceSchema,
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastAccessedAt: z.string(),
  /** When retention removes it, if nothing changes first; null for what it never removes. */
  expiresAt: z.string().nullable(),
  usedIn: LibraryUsedInSchema.nullable(),
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

/** A project's own retention choices; null takes the host's default. */
export const LibrarySettingsSchema = z.object({
  retentionDays: z.number().int().min(0).max(LIBRARY_RETENTION_DAYS_MAX).nullable(),
  capMb: z.number().int().min(0).max(LIBRARY_CAP_MB_MAX).nullable(),
});
export type LibrarySettings = z.infer<typeof LibrarySettingsSchema>;

export interface LibraryRetention {
  /** Days an automatic item stays; 0 keeps it. */
  retentionDays: number;
  /** The project's cap in MB; 0 is none. */
  capMb: number;
}

export interface LibraryUsage {
  /** Bytes the project's Library holds on disk, each stored file counted once. */
  bytes: number;
  capBytes: number | null;
  hostBytes: number;
  hostCapBytes: number | null;
}

export interface LibraryListing {
  items: LibraryItem[];
  usage: LibraryUsage;
  /** What applies to this project now: its own settings over the host's defaults. */
  retention: LibraryRetention;
  settings: LibrarySettings;
  defaults: LibraryRetention;
}

export const LibraryItemPatchSchema = z
  .object({
    name: z.string().optional(),
    folder: z.string().optional(),
    description: z.string().max(LIBRARY_LIMITS.descriptionMaxLength).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();
export type LibraryItemPatch = z.infer<typeof LibraryItemPatchSchema>;

/** A file name the Library can hold, trimmed, or null: no path separators or control characters. */
export const normalizeLibraryName = (name: string): string | null => {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > LIBRARY_LIMITS.nameMaxLength) return null;
  if (trimmed === "." || trimmed === "..") return null;
  return [...trimmed].some(isForbiddenNameChar) ? null : trimmed;
};

const isForbiddenNameChar = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return char === "/" || char === "\\" || code < 0x20 || code === 0x7f;
};

/** A folder path in its one spelling ("A/B", "" for the top), or null when it cannot be one. */
export const normalizeLibraryFolder = (folder: string): string | null => {
  const segments = folder
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length > LIBRARY_LIMITS.folderMaxDepth) return null;
  for (const segment of segments) {
    if (segment.length > LIBRARY_LIMITS.folderSegmentMaxLength) return null;
    if (normalizeLibraryName(segment) === null) return null;
  }
  return segments.join("/");
};

/** What the Library shows a file as, for its type filter and its preview. */
export type LibraryFileKind = "image" | "pdf" | "markdown" | "text" | "code" | "other";

const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
  "zsh",
  "mmd",
  "diff",
  "patch",
]);

export const libraryFileKind = (mimeType: string, name: string): LibraryFileKind => {
  const extension = name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/markdown" || extension === "md" || extension === "markdown") {
    return "markdown";
  }
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (mimeType.startsWith("text/") || mimeType === "application/json") return "text";
  return "other";
};
