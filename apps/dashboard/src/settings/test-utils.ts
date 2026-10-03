import type { CuaStatus, Device } from "@aop/common";

export const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: "dev_1",
  name: "Work laptop",
  createdAt: "2026-09-29T10:00:00.000Z",
  lastSeenAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...overrides,
});

/** A Linux host that lacks a display and the system packages: what the Computer use section fixes. */
export const makeCuaStatus = (overrides: Partial<CuaStatus> = {}): CuaStatus => ({
  status: "not-ready",
  reason: "no-display",
  detail: "No X display is up for CUA Driver to drive.",
  path: "/home/dev/.local/bin/cua-driver",
  version: "0.31.0",
  latestVersion: null,
  checks: [
    { id: "installed", label: "Installed", required: true, ok: true, detail: "0.31.0" },
    { id: "display", label: "Display", required: true, ok: false, detail: "DISPLAY is not set" },
    { id: "browser", label: "Browser", required: false, ok: null, detail: "" },
  ],
  fix: {
    command: "aop-nightly computer-use setup",
    sudoCommand: "sudo apt-get install -y xvfb openbox",
    missing: ["Xvfb", "a window manager"],
    pinnedVersion: "0.32.0",
  },
  host: { name: "build-box", platform: "linux" },
  checkedAt: "2026-10-03T12:00:00.000Z",
  ...overrides,
});
