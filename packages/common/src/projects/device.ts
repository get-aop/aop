import { z } from "zod";
import { IdSchema, TimestampSchema } from "./primitives.ts";

/**
 * A client paired with the host. This is the wire shape only: the bearer token is shown once
 * at pairing and the host keeps just its hash, so neither can appear here. Unknown keys are
 * stripped on parse, which keeps a stored token hash from leaking through a response.
 */
export const DeviceSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  createdAt: TimestampSchema,
  lastSeenAt: TimestampSchema.nullable(),
});
export type Device = z.infer<typeof DeviceSchema>;
