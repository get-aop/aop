import { z } from "zod";
import { TimestampSchema } from "./projects/primitives.ts";

/**
 * When the dashboard shows the live view of the host's screen while a thread uses computer use
 * (the host setting `live_view`): never, only to a viewer on another machine than the host (a
 * paired device: the desktop app or a browser on another computer), or to every viewer.
 */
export const LiveViewModeSchema = z.enum(["off", "remote", "always"]);
export type LiveViewMode = z.infer<typeof LiveViewModeSchema>;

export const DEFAULT_LIVE_VIEW_MODE: LiveViewMode = "remote";

/** Who is looking, as the host sees the request: the person at the host machine, or a paired device. */
export type LiveViewViewer = "owner" | "device";

/** Whether a viewer gets the live view under a mode. The host enforces it; the dashboard follows. */
export const liveViewShownTo = (mode: LiveViewMode, viewer: LiveViewViewer): boolean =>
  mode === "always" || (mode === "remote" && viewer === "device");

/** Reads a stored setting value; anything unknown falls back to the default. */
export const parseLiveViewMode = (value: string | null | undefined): LiveViewMode => {
  const parsed = LiveViewModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_LIVE_VIEW_MODE;
};

/**
 * A thread that is using CUA Driver on the host, heard from its own `mcp__cua-driver__*` tool
 * calls. `ending` is set from when its CUA session ended (it called `end_session`, its turn
 * ended, or it went quiet) until the view lets it go a few seconds later.
 */
export const LiveViewSessionSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  title: z.string(),
  startedAt: TimestampSchema,
  lastActivityAt: TimestampSchema,
  ending: z.boolean(),
});
export type LiveViewSession = z.infer<typeof LiveViewSessionSchema>;

/**
 * The host's screen capture. `idle`: nobody is watching or no CUA session is active. `starting`:
 * a viewer asked and the first frame is on its way. `live`: frames are flowing. `unavailable`:
 * this host cannot capture (`detail` says why: not supported on this system, ffmpeg missing, no
 * display, or the capture failed).
 */
export const LiveViewCaptureSchema = z.object({
  state: z.enum(["idle", "starting", "live", "unavailable"]),
  detail: z.string().nullable(),
});
export type LiveViewCapture = z.infer<typeof LiveViewCaptureSchema>;

/** `GET /api/computer-use/live`. `shown` is `liveViewShownTo(mode, viewer)` for this caller. */
export const LiveViewStatusSchema = z.object({
  mode: LiveViewModeSchema,
  viewer: z.enum(["owner", "device"]),
  shown: z.boolean(),
  /** Most recently active first. */
  sessions: z.array(LiveViewSessionSchema),
  capture: LiveViewCaptureSchema,
});
export type LiveViewStatus = z.infer<typeof LiveViewStatusSchema>;
