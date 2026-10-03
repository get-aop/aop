import { z } from "zod";

/**
 * The host's setup checklist (AOP settings › Host, and the first-run card on the home page), as
 * `GET /api/host/setup` reports it. Each check says what it found in plain words and what can be
 * done about it.
 */
export const SetupCheckIdSchema = z.enum([
  "service",
  "reachable",
  "claude",
  "github",
  "computer-use",
  "updates",
  "slack-inbox",
]);
export type SetupCheckId = z.infer<typeof SetupCheckIdSchema>;

/**
 * What a check offers. `fix`: the host can do it itself (`POST /api/host/setup/:id/fix`, for whoever
 * may manage the host). `how-to`: steps to run on the host, worded for whoever reads them, with
 * the one command to copy. `link`: a page of the dashboard that has the rest.
 */
export const SetupActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fix"), label: z.string() }),
  z.object({
    kind: z.literal("how-to"),
    steps: z.array(z.string()),
    command: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("link"),
    label: z.string(),
    target: z.enum(["runtimes", "updates", "live-view", "connections"]),
  }),
]);
export type SetupAction = z.infer<typeof SetupActionSchema>;

export const SetupCheckSchema = z.object({
  id: SetupCheckIdSchema,
  /** `optional`: off on purpose (no project uses computer use); does not count against ready. */
  state: z.enum(["ok", "warning", "error", "optional"]),
  title: z.string(),
  /** One line under the title: what it found ("systemd user unit aop-nightly-local-server…"). */
  detail: z.string(),
  actions: z.array(SetupActionSchema),
});
export type SetupCheck = z.infer<typeof SetupCheckSchema>;

export const HostSetupSchema = z.object({
  hostName: z.string(),
  /** `process.platform` of the host. */
  os: z.string(),
  channel: z.enum(["stable", "nightly"]),
  version: z.string(),
  uptimeSeconds: z.number(),
  /** Addresses other devices reach the host on (the `tailscale serve` URL), best first. */
  addresses: z.array(z.string()),
  checks: z.array(SetupCheckSchema),
  /** How many non-optional checks are ok, and how many there are: "5 of 6 ready". */
  ready: z.number().int(),
  total: z.number().int(),
});
export type HostSetup = z.infer<typeof HostSetupSchema>;

/** A check is done when it is ok or optional. */
export const setupIsComplete = (setup: Pick<HostSetup, "ready" | "total">): boolean =>
  setup.ready >= setup.total;

/**
 * The command that publishes a host on the tailnet over HTTPS. Stable takes 443; AOP Nightly
 * (or a host whose 443 is already taken, by Stable on the same machine) uses its own port, so
 * the two never fight over one address. install.sh follows the same rule.
 */
export const tailscaleServeCommand = (
  port: number,
  channel: "stable" | "nightly",
  httpsDefaultTaken = false,
): string => {
  const httpsPort = httpsDefaultTaken || channel === "nightly" ? port : 443;
  return `tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${port}`;
};
