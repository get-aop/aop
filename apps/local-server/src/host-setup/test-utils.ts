import {
  CHANNELS,
  CUA_DRIVER_VERSION,
  type CuaCheck,
  type CuaLeaseState,
  type CuaStatus,
  EMPTY_CUA_LEASE,
} from "@aop/common";
import type { HostFacts, HostSetupProbes } from "./probes.ts";

export const HOST = "soulf";

export const NIGHTLY = CHANNELS.nightly;

export const FACTS: HostFacts = {
  hostName: HOST,
  os: "linux",
  channel: NIGHTLY,
  version: "0.10.8-nightly.20261002.17",
  port: 25650,
  uptimeSeconds: () => 3 * 3600 + 0.4,
};

const check = (
  id: CuaCheck["id"],
  label: string,
  ok: boolean | null,
  detail: string,
): CuaCheck => ({
  id,
  label,
  required: id === "display" || id === "installed" || id === "answers",
  ok,
  detail,
});

/** CUA Driver ready on a Linux host with a virtual screen and Chrome, unless overridden. */
export const cuaStatus = (overrides: Partial<CuaStatus> = {}): CuaStatus => ({
  status: "ready",
  reason: "ready",
  detail: `CUA Driver ${CUA_DRIVER_VERSION} is ready on this host.`,
  path: "/home/ada/.local/bin/cua-driver",
  version: CUA_DRIVER_VERSION,
  latestVersion: null,
  checks: [
    check("installed", "Installed", true, "At /home/ada/.local/bin/cua-driver."),
    check("display", "Screen", true, "X display :99 is up."),
    check(
      "system-packages",
      "System packages",
      true,
      "Everything computer use needs is installed.",
    ),
    check("browser", "Browser", true, "/opt/google/chrome/google-chrome (browser tools work)."),
  ],
  fix: { command: null, sudoCommand: null, missing: [], pinnedVersion: CUA_DRIVER_VERSION },
  host: { name: HOST, platform: "linux" },
  checkedAt: "2026-10-03T09:00:00.000Z",
  ...overrides,
});

/** The screen is down: setup can bring it up without a password. */
export const cuaNoScreen = (): CuaStatus =>
  cuaStatus({
    status: "not-ready",
    reason: "no-display",
    detail: "CUA Driver has no screen to drive. X display :99 is not running.",
    checks: [
      check("installed", "Installed", true, "At /home/ada/.local/bin/cua-driver."),
      check("display", "Screen", false, "X display :99 is not running."),
      check("browser", "Browser", true, "/opt/google/chrome/google-chrome (browser tools work)."),
    ],
    fix: {
      command: "aop-nightly computer-use setup",
      sudoCommand: null,
      missing: [],
      pinnedVersion: CUA_DRIVER_VERSION,
    },
  });

export const BUSY_LEASE: CuaLeaseState = {
  holder: {
    kind: "thread",
    threadId: "thr_a",
    projectId: "prj_1",
    title: "Umbral CI retest",
    since: "2026-10-03T09:00:00.000Z",
    lastCallAt: "2026-10-03T09:01:00.000Z",
  },
  queue: [
    {
      threadId: "thr_b",
      projectId: "prj_1",
      title: "Fix the footer",
      since: "2026-10-03T09:00:30.000Z",
      position: 1,
    },
  ],
  idleReleaseMs: 180_000,
};

/** A host where everything is set up, as each probe answers; override one probe per test. */
export const readyProbes = (overrides: Partial<HostSetupProbes> = {}): HostSetupProbes => ({
  service: async () => ({ kind: "systemd", unit: "aop-nightly-local-server.service" }),
  serve: async () => ({
    tailscale: true,
    addresses: ["https://soulf.tailffbdec.ts.net:25650"],
    httpsDefaultTaken: true,
  }),
  claude: async () => ({
    status: {
      runtimeId: "claude-code",
      path: "/home/ada/.local/bin/claude",
      version: "2.1.288",
      auth: "logged-in",
      ready: true,
      reason: null,
      checkedAt: "2026-10-03T09:00:00.000Z",
    },
    isDefault: true,
  }),
  github: async () => ({ authenticated: true, login: "marcelormendes" }),
  computerUse: async () => ({ status: cuaStatus(), lease: EMPTY_CUA_LEASE, wanted: true }),
  updates: async () => ({ checking: true, mode: "idle", window: null, block: null }),
  setupComputerUse: async () => 0,
  ...overrides,
});
