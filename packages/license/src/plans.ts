import { z } from "zod";

export const LicensePlanSchema = z.enum(["free", "pro", "team"]);
export type LicensePlan = z.infer<typeof LicensePlanSchema>;

export const LICENSE_PRICING = {
  free: { label: "Free", priceUsdMonthly: 0, maxActiveWorkers: 4 },
  pro: { label: "Pro", priceUsdMonthly: 2.99, maxActiveWorkers: 8 },
  team: {
    label: "Team",
    labelDetail: "Unlimited workers",
    priceUsdMonthly: 4.99,
    maxActiveWorkers: null,
  },
} as const;

export const FREE_MAX_ACTIVE_WORKERS = LICENSE_PRICING.free.maxActiveWorkers;

export const resolveMaxActiveWorkers = (plan: LicensePlan): number | null =>
  LICENSE_PRICING[plan].maxActiveWorkers;

export const isWorkerLimitReached = (activeCount: number, maxWorkers: number | null): boolean =>
  maxWorkers !== null && activeCount >= maxWorkers;
