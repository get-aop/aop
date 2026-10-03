import { join } from "node:path";
import type { SetupSystem } from "./system.ts";

/**
 * The screen threads drive on Linux. By default a virtual one: an Xvfb display with openbox on
 * it, as two systemd user services that start at boot (with linger, also before anyone logs in),
 * so threads never move the person's own mouse and windows. A person at a desktop session can
 * choose it instead.
 */
export const DEFAULT_VIRTUAL_DISPLAY = ":99";
export const XVFB_UNIT = "aop-xvfb.service";
export const OPENBOX_UNIT = "aop-openbox.service";
const SCREEN = "1920x1080x24";

export interface DesktopSession {
  kind: "x11" | "wayland";
  /** The X display of the session (Xwayland's on Wayland), when there is one. */
  display: string | null;
}

/** The person's own graphical session on this machine, if one is up. */
export const detectDesktop = (sys: SetupSystem, virtualDisplay: string): DesktopSession | null => {
  const ours = displayNumber(virtualDisplay);
  const sockets = sys
    .list("/tmp/.X11-unix")
    .map((name) => /^X(\d+)$/.exec(name)?.[1])
    .filter((n): n is string => n !== undefined && n !== ours);
  const display = sockets.length > 0 ? `:${sockets[0]}` : null;
  const runtime = sys.env.XDG_RUNTIME_DIR;
  const wayland =
    Boolean(sys.env.WAYLAND_DISPLAY) ||
    (runtime ? sys.list(runtime).some((name) => /^wayland-\d+$/.test(name)) : false);
  if (wayland) return { kind: "wayland", display };
  return display ? { kind: "x11", display } : null;
};

/** Whether an X display is up: a local `:N` listens on /tmp/.X11-unix/XN. */
export const displayRunning = (sys: SetupSystem, display: string): boolean => {
  const n = displayNumber(display);
  return n === null ? true : sys.exists(`/tmp/.X11-unix/X${n}`);
};

export const unitDir = (sys: SetupSystem): string => join(sys.home, ".config", "systemd", "user");

/** The two unit files for a virtual display, as setup writes them. */
export const virtualDisplayUnits = (
  display: string,
  paths: { xvfb: string; openbox: string },
): Record<string, string> => {
  const n = displayNumber(display) ?? "99";
  return {
    [XVFB_UNIT]: `[Unit]
Description=Virtual display ${display} for computer use (CUA)

[Service]
ExecStart=${paths.xvfb} ${display} -screen 0 ${SCREEN} -nolisten tcp
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`,
    [OPENBOX_UNIT]: `[Unit]
Description=Window manager on ${display} for computer use (CUA)
Requires=${XVFB_UNIT}
After=${XVFB_UNIT}

[Service]
Environment=DISPLAY=${display}
ExecStartPre=/bin/sh -c "for i in $(seq 30); do [ -S /tmp/.X11-unix/X${n} ] && exit 0; sleep 0.5; done; exit 1"
ExecStart=${paths.openbox}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`,
  };
};

export interface VirtualDisplayResult {
  /** Unit files written because they were missing or different. */
  written: string[];
  started: boolean;
  /** Why the display could not be started yet, for the person. */
  problem: string | null;
}

/**
 * Writes the units (only when they differ), then enables and starts them. Nothing restarts when
 * they are already as wanted and running, so a second setup changes nothing.
 */
export const ensureVirtualDisplay = async (
  sys: SetupSystem,
  display: string,
): Promise<VirtualDisplayResult> => {
  const xvfb = sys.which("Xvfb");
  const openbox = sys.which("openbox");
  if (!xvfb || !openbox) {
    return {
      written: [],
      started: false,
      problem: "Xvfb and openbox are not installed yet (see the sudo command).",
    };
  }
  if (!sys.which("systemctl")) {
    return { written: [], started: false, problem: "systemd is not available for user services." };
  }
  const written = writeChangedUnits(sys, virtualDisplayUnits(display, { xvfb, openbox }));
  if (written.length > 0) await sys.run(["systemctl", "--user", "daemon-reload"]);
  const enabled = await sys.run(["systemctl", "--user", "enable", XVFB_UNIT, OPENBOX_UNIT]);
  // A changed unit is restarted so it takes the new display; an unchanged running one is left.
  const verb = written.length > 0 ? "restart" : "start";
  const started = await sys.run(["systemctl", "--user", verb, XVFB_UNIT, OPENBOX_UNIT]);
  if (enabled.exitCode !== 0 || started.exitCode !== 0) {
    return {
      written,
      started: false,
      problem: `systemctl failed: ${(started.output || enabled.output).trim().slice(0, 300)}`,
    };
  }
  return { written, started: true, problem: null };
};

/** Writes the units whose files differ, and names them. */
const writeChangedUnits = (sys: SetupSystem, units: Record<string, string>): string[] =>
  Object.entries(units).flatMap(([name, text]) => {
    const path = join(unitDir(sys), name);
    if (sys.readText(path) === text) return [];
    sys.writeText(path, text);
    return [name];
  });

/** Whether the user's services run without a login session (at boot). */
export const lingerEnabled = async (sys: SetupSystem): Promise<boolean | null> => {
  if (!sys.which("loginctl")) return null;
  const result = await sys.run(["loginctl", "show-user", sys.user, "-p", "Linger"]);
  if (result.exitCode !== 0) return null;
  return result.output.trim() === "Linger=yes";
};

/** Turns linger on for the user; polkit lets a user do it for themselves on most systems. */
export const enableLinger = async (sys: SetupSystem): Promise<boolean> =>
  (await sys.run(["loginctl", "enable-linger", sys.user])).exitCode === 0;

export const displayNumber = (display: string): string | null =>
  /^:(\d+)(\.\d+)?$/.exec(display)?.[1] ?? null;
