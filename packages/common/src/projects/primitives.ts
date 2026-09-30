import { z } from "zod";

/** Opaque server-assigned identifier. Format is the server's business; only emptiness is rejected. */
export const IdSchema = z.string().min(1).max(200);

/** ISO-8601 instant, as produced by `Date.prototype.toISOString()`; offsets are accepted. */
export const TimestampSchema = z.iso.datetime({ offset: true });
