import { type PlanUsage, PlanUsageResponseSchema } from "@aop/common";
import { request } from "./request";

/** The Claude plan's usage as the host last heard it; null until a run has reported it. */
export const getPlanUsage = async (): Promise<PlanUsage | null> =>
  PlanUsageResponseSchema.parse(await request<unknown>("/usage/plan")).usage;
