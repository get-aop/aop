import { type LiveViewStatus, LiveViewStatusSchema } from "@aop/common";
import { apiUrl, authHeaders, isRemoteHost } from "./host";
import { request } from "./request";

/** Who uses CUA on the host, whether this viewer gets the live view, and how the capture is doing. */
export const getLiveViewStatus = async (): Promise<LiveViewStatus> =>
  LiveViewStatusSchema.parse(await request<unknown>("/computer-use/live"));

/**
 * One frame of the host's screen. `unchanged` when the host still shows the frame `etag` names;
 * `refused` carries the host's reason (the live view is off, the capture is starting, or the host
 * cannot capture). A plain `fetch`, so a device token rides along as a header (an `<img src>`
 * could not send it).
 */
export type LiveFrame =
  | { kind: "frame"; blob: Blob; etag: string | null }
  | { kind: "unchanged" }
  | { kind: "refused"; code: string; error: string };

export const fetchLiveFrame = async (
  etag: string | null,
  signal?: AbortSignal,
): Promise<LiveFrame> => {
  const response = await fetch(apiUrl("/computer-use/live/frame"), {
    cache: "no-store",
    credentials: isRemoteHost() ? "include" : "same-origin",
    headers: { ...authHeaders(), ...(etag ? { "If-None-Match": etag } : {}) },
    signal,
  });
  if (response.status === 304) return { kind: "unchanged" };
  if (response.ok) {
    return { kind: "frame", blob: await response.blob(), etag: response.headers.get("ETag") };
  }
  const body = (await response.json().catch(() => ({}))) as { code?: unknown; error?: unknown };
  return {
    kind: "refused",
    code: typeof body.code === "string" ? body.code : "UNKNOWN",
    error: typeof body.error === "string" ? body.error : `The host answered ${response.status}.`,
  };
};
