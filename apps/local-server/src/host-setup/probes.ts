import type {
  ChannelConfig,
  CuaLeaseState,
  CuaStatus,
  GithubAuth,
  RuntimeStatus,
  SlackConnection,
  UpdateInstallMode,
} from "@aop/common";

/**
 * What the setup checklist looks at on the host. Each probe is one look, with no wording: the
 * checks (`*-check.ts`) turn what it found into words and actions. Tests pass fakes, so nothing
 * here shells out under test.
 */
export interface HostSetupProbes {
  /** How the host is kept running. */
  service: () => Promise<ServiceLook>;
  /** What `tailscale serve` publishes that reaches this host's port. */
  serve: () => Promise<ServeLook>;
  /** Claude Code, the built-in runtime; null when the host has no built-in runtime row. */
  claude: (fresh: boolean) => Promise<ClaudeLook | null>;
  /** The host's own `gh` login. */
  github: (fresh: boolean) => Promise<GithubAuth>;
  computerUse: (fresh: boolean) => Promise<ComputerUseLook>;
  updates: () => Promise<UpdatesLook>;
  /** The Slack workspace the Inbox reads, and how its feed is doing; null when none is connected. */
  slackInbox: () => Promise<SlackConnection | null>;
  /** `aop computer-use setup` without sudo or questions; resolves with its exit code. */
  setupComputerUse: () => Promise<number>;
}

/** The host itself, as the checklist's header names it. */
export interface HostFacts {
  hostName: string;
  os: string;
  channel: ChannelConfig;
  version: string;
  port: number;
  uptimeSeconds: () => number;
}

/**
 * How the host runs: under a service manager install.sh registered, started with `run
 * --background` or by hand, inside the macOS app, or from a source checkout.
 */
export type ServiceLook =
  | { kind: "systemd"; unit: string }
  | { kind: "launchd"; label: string }
  /** `binaryPath`: the installed binary that runs, which install.sh has to put back in place. */
  | { kind: "background"; binaryPath: string }
  | { kind: "manual"; binaryPath: string }
  | { kind: "app" }
  | { kind: "source" };

export interface ServeLook {
  /** Whether the `tailscale` command answered at all. */
  tailscale: boolean;
  /** The URLs `tailscale serve` proxies to this host's port, at their root. */
  addresses: string[];
  /** Whether https port 443 already serves something else, so the how-to uses another port. */
  httpsDefaultTaken: boolean;
}

export interface ClaudeLook {
  status: RuntimeStatus;
  /** It is the runtime new projects start on. */
  isDefault: boolean;
}

export interface ComputerUseLook {
  status: CuaStatus;
  lease: CuaLeaseState;
  /** Some project lets its threads use the computer; without one, computer use is optional. */
  wanted: boolean;
}

export interface UpdatesLook {
  /** The `update_check` setting. */
  checking: boolean;
  mode: UpdateInstallMode;
  /** `HH:MM-HH:MM`, for `window`. */
  window: string | null;
  /** Why the host does not update itself: it runs from source or inside the app. */
  block: "source" | "app" | null;
}
