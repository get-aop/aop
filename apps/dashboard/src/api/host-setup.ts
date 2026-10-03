import { type HostSetup, HostSetupSchema, type SetupCheckId } from "@aop/common";
import { request } from "./request";

/** The host's setup checklist: what is ready and what to do about the rest. Any device may read. */
export const getHostSetup = async (): Promise<HostSetup> =>
  HostSetupSchema.parse(await request<unknown>("/host/setup"));

/** Runs a check's fix on the host and answers the checklist as it is after it. */
export const fixSetupCheck = async (id: SetupCheckId): Promise<HostSetup> =>
  HostSetupSchema.parse(await request<unknown>(`/host/setup/${id}/fix`, { method: "POST" }));
