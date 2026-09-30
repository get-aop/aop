import type { DesktopState } from "./backend/types";

export type Screen = "connect" | "host" | "status";

/** The screen a `#/…` address names, or null when it names none. */
export const parseScreenHash = (hash: string): Screen | null => {
  const name = /^#\/?(.*)$/.exec(hash)?.[1];
  return name === "connect" || name === "host" || name === "status" ? name : null;
};

/**
 * Which screen to show. The address wins when the app asked for one (its menu does, and so does
 * a click on "Change host"); otherwise the state decides: a Mac that runs its own host shows that
 * host, a client of a remote host shows how the connection is, and a fresh install connects.
 */
export const chooseScreen = (state: DesktopState, requested: Screen | null): Screen => {
  if (requested === "host") return state.hostModeAvailable ? "host" : "connect";
  if (requested === "status") return state.mode === null ? "connect" : "status";
  if (requested) return requested;
  if (state.mode === "local" && state.hostModeAvailable) return "host";
  return state.mode === "remote" ? "status" : "connect";
};
