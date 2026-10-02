import { z } from "zod";

/**
 * The version of the HTTP API and event stream a host speaks, and of the one a client was
 * built against. Raise it when a change would break a client that is one release behind
 * (a renamed field, a removed route), not for additions. A desktop app carries its own copy
 * of the dashboard, so it and its host upgrade separately and must agree on this.
 */
export const API_VERSION = 1;

/** The oldest client API version this host still serves. Raise it only when old clients cannot work. */
export const MIN_CLIENT_API_VERSION = 1;

/**
 * The origin the desktop app's bundled dashboard runs at. A host accepts browser requests
 * from it without configuration, because only the desktop app can produce it: a web page
 * cannot claim another scheme's origin.
 */
export const DESKTOP_APP_ORIGIN = "app://aop";

/** What `GET /api/health` tells a client before it has any credentials. */
export const HostHealthSchema = z.object({
  service: z.literal("aop"),
  /** The host's release, for showing to the person. Never compared: use the API versions. */
  version: z.string().min(1),
  /** `stable` or `nightly` (docs/NIGHTLY.md); hosts before channels existed leave it out. */
  channel: z.string().optional(),
  apiVersion: z.number().int().positive(),
  minClientApiVersion: z.number().int().positive(),
});
export type HostHealth = z.infer<typeof HostHealthSchema>;

export type HostCompatibility =
  | { status: "compatible" }
  /** The client is older than the host allows: the person updates the app. */
  | { status: "client-too-old" }
  /** The client is newer than the host: the person updates the host. */
  | { status: "host-too-old" };

/** Whether a client built for `clientApiVersion` can talk to a host that reported `health`. */
export const checkHostCompatibility = (
  health: Pick<HostHealth, "apiVersion" | "minClientApiVersion">,
  clientApiVersion: number = API_VERSION,
): HostCompatibility => {
  if (clientApiVersion < health.minClientApiVersion) return { status: "client-too-old" };
  if (clientApiVersion > health.apiVersion) return { status: "host-too-old" };
  return { status: "compatible" };
};
