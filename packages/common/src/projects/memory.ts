import { z } from "zod";
import { TimestampSchema } from "./primitives.ts";

/** The index every session reads first; topic files hold the detail. */
export const MEMORY_INDEX_NAME = "MEMORY.md";

export const MEMORY_DESCRIPTION_MAX_LENGTH = 300;
export const MEMORY_BODY_MAX_LENGTH = 50_000;
/** The longest request Memory settings send the coordinator; its frame stays well inside a message's limit. */
export const MEMORY_REQUEST_MAX_LENGTH = 4_000;

/** Letters, digits, `.`, `_` and `-`, ending in `.md`, so a name is safe as a key and as a path. */
export const MEMORY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/;

/** What a client or a tool sends to create a memory file or replace one. */
export const MemoryFileInputSchema = z.object({
  name: z.string().regex(MEMORY_NAME_PATTERN, {
    error: "Memory file names are letters, digits, . _ - and end in .md",
  }),
  description: z.string().max(MEMORY_DESCRIPTION_MAX_LENGTH).default(""),
  body: z.string().max(MEMORY_BODY_MAX_LENGTH),
});
export type MemoryFileInput = z.input<typeof MemoryFileInputSchema>;

/** One memory file of a project: the `MEMORY.md` index or a topic file. */
export const MemoryFileSchema = MemoryFileInputSchema.extend({
  updatedAt: TimestampSchema,
});
export type MemoryFile = z.infer<typeof MemoryFileSchema>;
