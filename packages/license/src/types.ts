import { z } from "zod";
import { FREE_MAX_ACTIVE_WORKERS, LicensePlanSchema } from "./plans.ts";

export const LicenseEntitlementSchema = z.object({
  plan: LicensePlanSchema,
  maxActiveWorkers: z.number().int().positive().nullable(),
  expiresAt: z.string().datetime().nullable(),
  licenseKeyLast4: z.string().max(8).optional(),
  source: z.enum(["free", "signed", "lemonsqueezy"]),
});

export type LicenseEntitlement = z.infer<typeof LicenseEntitlementSchema>;

export const LicenseStatusSchema = z.object({
  plan: LicensePlanSchema,
  maxActiveWorkers: z.number().int().positive().nullable(),
  activeWorkers: z.number().int().nonnegative(),
  expiresAt: z.string().datetime().nullable(),
  licenseKeyLast4: z.string().nullable(),
  machineId: z.string(),
  canActivate: z.boolean(),
  lastValidatedAt: z.string().datetime().nullable().optional(),
  licenseServerUrl: z.string().nullable().optional(),
});

export type LicenseStatus = z.infer<typeof LicenseStatusSchema>;

export const freeEntitlement = (): LicenseEntitlement => ({
  plan: "free",
  maxActiveWorkers: FREE_MAX_ACTIVE_WORKERS,
  expiresAt: null,
  source: "free",
});
