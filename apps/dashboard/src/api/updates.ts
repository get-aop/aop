import { type UpdateStatus, UpdateStatusSchema } from "@aop/common";
import { request } from "./request";

/** The host's release and whether a newer one is published. Any paired device may ask. */
export const getUpdateStatus = async (): Promise<UpdateStatus> =>
  UpdateStatusSchema.parse(await request<unknown>("/updates"));

/** Asks the host to look for a release now instead of waiting for its daily check. */
export const checkForUpdate = async (): Promise<UpdateStatus> =>
  UpdateStatusSchema.parse(await request<unknown>("/updates/check", { method: "POST" }));

/**
 * Host owner only. The host answers once the update has started and then goes away until it
 * runs the new release, so a resolved call means "started", not "done".
 */
export const applyUpdate = async (): Promise<void> => {
  await request<unknown>("/updates/apply", { method: "POST" });
};
