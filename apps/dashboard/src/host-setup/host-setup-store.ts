import type { HostSetup, SetupCheckId } from "@aop/common";
import { useEffect, useSyncExternalStore } from "react";
import { fixSetupCheck, getHostSetup } from "../api/host-setup";

/**
 * The host's setup checklist, shared by AOP settings › Host, the first-run card on the home page
 * and the amber dots that say a check needs attention.
 */
export interface HostSetupState {
  setup: HostSetup | null;
  loading: boolean;
  /** The check whose fix is running on the host. */
  fixing: SetupCheckId | null;
  error: string | null;
}

const INITIAL: HostSetupState = { setup: null, loading: false, fixing: null, error: null };
const REFRESH_MS = 5 * 60_000;

let state: HostSetupState = INITIAL;
let lastLoad = 0;
const listeners = new Set<() => void>();

export const useHostSetupState = (): HostSetupState => useSyncExternalStore(subscribe, () => state);

/** The checklist, read on mount and again when it is five minutes old. */
export const useHostSetup = (): HostSetupState => {
  useEffect(() => {
    if (Date.now() - lastLoad > REFRESH_MS) void refreshHostSetup();
  }, []);
  return useHostSetupState();
};

/** The host's OS, once the checklist has been read: for "Host soulf · Linux". */
export const useHostSetupOs = (): string | null => useHostSetup().setup?.os ?? null;

/** A check failed or warns: AOP settings › Host and the switcher's settings item get a dot. */
export const needsAttention = (setup: HostSetup | null): boolean =>
  Boolean(setup?.checks.some((check) => check.state === "error" || check.state === "warning"));

export const refreshHostSetup = async (): Promise<void> => {
  lastLoad = Date.now();
  publish({ loading: true });
  try {
    publish({ setup: await getHostSetup(), loading: false, error: null });
  } catch (error) {
    publish({ loading: false, error: messageOf(error, "Could not read the host's setup.") });
  }
};

/** Runs a fix on the host, then shows the checklist as it is after it. */
export const runSetupFix = async (id: SetupCheckId): Promise<void> => {
  publish({ fixing: id, error: null });
  try {
    publish({ setup: await fixSetupCheck(id), fixing: null });
  } catch (error) {
    publish({ fixing: null, error: messageOf(error, "The fix did not work.") });
  }
};

/** Test seam. */
export const resetHostSetupForTests = (setup: HostSetup | null = null): void => {
  state = { ...INITIAL, setup };
  lastLoad = setup ? Date.now() : 0;
  for (const listener of listeners) listener();
};

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const publish = (patch: Partial<HostSetupState>): void => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
