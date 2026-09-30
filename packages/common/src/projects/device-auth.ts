import { z } from "zod";
import { DeviceSchema } from "./device.ts";
import { TimestampSchema } from "./primitives.ts";

/** Who a request is acting as, as `GET /api/auth/me` reports it. */
export const AuthPrincipalSchema = z.discriminatedUnion("kind", [
  /** The person at the host machine itself: a request made directly on loopback. */
  z.object({ kind: z.literal("owner") }),
  /** A paired client that presented its bearer token or the cookie the host set for it. */
  z.object({ kind: z.literal("device"), device: DeviceSchema }),
]);
export type AuthPrincipal = z.infer<typeof AuthPrincipalSchema>;

/** A one-time code the host owner reads off the host and types into a new client. */
export const PairingCodeSchema = z.object({
  code: z.string().min(1),
  expiresAt: TimestampSchema,
});
export type PairingCode = z.infer<typeof PairingCodeSchema>;

export const PairDeviceRequestSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: DeviceSchema.shape.name,
});
export type PairDeviceRequest = z.infer<typeof PairDeviceRequestSchema>;

/** Returned once. The host keeps only a hash of `token`, so a lost token means pairing again. */
export const PairedDeviceSchema = z.object({
  device: DeviceSchema,
  token: z.string().min(1),
});
export type PairedDevice = z.infer<typeof PairedDeviceSchema>;
