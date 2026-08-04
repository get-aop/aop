import { z } from "zod";

export const ExecHostConfigSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().min(1),
  user: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().trim().min(1).optional(),
  /** Remote directory AOP may use for task workspaces. */
  remoteRoot: z.string().trim().min(1),
});

export type ExecHostConfig = z.infer<typeof ExecHostConfigSchema>;

/** Input when creating a host (id may be assigned by the server). */
export const ExecHostConfigInputSchema = ExecHostConfigSchema.omit({ id: true });
export type ExecHostConfigInput = z.infer<typeof ExecHostConfigInputSchema>;

/** Full-list PUT payload entry: a config whose id is assigned by the server when absent. */
export const ExecHostUpsertSchema = ExecHostConfigInputSchema.extend({
  id: z.string().trim().min(1).optional(),
});
export type ExecHostUpsert = z.infer<typeof ExecHostUpsertSchema>;

export const ExecHostConfigPatchSchema = ExecHostConfigInputSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  "At least one host field is required",
);
export type ExecHostConfigPatch = z.infer<typeof ExecHostConfigPatchSchema>;

const ExecHostListSchema = z.array(ExecHostConfigSchema);

/**
 * Parse a JSON array of execution hosts (settings storage). Empty string → [].
 * Throws on invalid JSON or schema failures.
 */
export const parseExecHostList = (raw: string): ExecHostConfig[] => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  return ExecHostListSchema.parse(JSON.parse(trimmed));
};
