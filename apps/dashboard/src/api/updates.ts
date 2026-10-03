import { type ApplyUpdateRequest, type UpdateStatus, UpdateStatusSchema } from "@aop/common";
import { request } from "./request";

/** The host's release, whether a newer one is out, and what this client may do about it. */
export const getUpdateStatus = async (): Promise<UpdateStatus> =>
  UpdateStatusSchema.parse(await request<unknown>("/updates"));

/** Asks the host to look for a release now instead of waiting for its own check. */
export const checkForUpdate = async (): Promise<UpdateStatus> =>
  UpdateStatusSchema.parse(await request<unknown>("/updates/check", { method: "POST" }));

/**
 * Starts the host's update now, or once the turns running now have finished (`idle`). The host
 * answers once it has started or queued it and then, for `now`, goes away until it runs the new
 * release, so a resolved call means "started", not "done".
 */
export const applyUpdate = async (
  when: ApplyUpdateRequest["when"] = "now",
): Promise<{ queued: boolean }> =>
  request<{ queued: boolean }>("/updates/apply", {
    method: "POST",
    body: JSON.stringify({ when }),
  });

/** Drops an update queued for when the running turns finish. */
export const cancelQueuedUpdate = async (): Promise<void> => {
  await request<unknown>("/updates/apply", { method: "DELETE" });
};

/** The end of the host's update log, for "Show log" after a failed update. */
export const getUpdateLog = async (): Promise<string> =>
  (await request<{ lines: string[] }>("/updates/log")).lines.join("\n");
