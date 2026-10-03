import {
  DEFAULT_UPDATE_INSTALL_WINDOW,
  inInstallWindow,
  parseInstallWindow,
  type UpdateInstallMode,
  UpdateInstallModeSchema,
} from "@aop/common";

/** When the host installs a newer release by itself: the `update_install` settings. */
export interface InstallPolicy {
  mode: UpdateInstallMode;
  /** `[startMinute, endMinute)` of the day, host time; read only in "window" mode. */
  window: [number, number];
}

/** Reads the stored settings; a value the host cannot read asks, the safe choice. */
export const parseInstallPolicy = (mode: string, window: string): InstallPolicy => ({
  mode: UpdateInstallModeSchema.safeParse(mode).data ?? "ask",
  window: parseInstallWindow(window) ?? DEFAULT_WINDOW,
});

/**
 * Whether the host may queue or start an install by itself at `minuteOfDay` (host time). "ask"
 * never does; "idle" always may (the queue still waits for the running turns); "window" only
 * inside its hours, so an install queued before the window closes and not yet started waits for
 * the next one.
 */
export const installsByItselfAt = (policy: InstallPolicy, minuteOfDay: number): boolean =>
  policy.mode === "idle" ||
  (policy.mode === "window" && inInstallWindow(policy.window, minuteOfDay));

/** The minute of the day on this host's clock, which the window hours are written in. */
export const localMinuteOfDay = (ms: number): number => {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
};

const DEFAULT_WINDOW: [number, number] = parseInstallWindow(DEFAULT_UPDATE_INSTALL_WINDOW) ?? [
  60, 360,
];
