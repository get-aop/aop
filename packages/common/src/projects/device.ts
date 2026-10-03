import { z } from "zod";
import { ClientInfoSchema } from "../desktop-app.ts";
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
  /** The app and version it last connected with, null until it has (migration, CLIENT_HEADER). */
  client: ClientInfoSchema.nullable().optional(),
  /** A desktop app older than the host on the same channel: it should update. */
  outOfDate: z.boolean().optional(),
});
export type Device = z.infer<typeof DeviceSchema>;
