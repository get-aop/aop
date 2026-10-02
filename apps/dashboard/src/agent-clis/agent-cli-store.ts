import type { AgentCliStatus, AgentClisResponse } from "@aop/common";
import { useSyncExternalStore } from "react";
import {
  checkAgentClis,
  getAgentClis,
  setSkipPermissions,
  updateAgentCli,
} from "../api/agent-clis";

/**
 * What every agent CLI surface (the Runtimes panel, the sidebar notice, the nav dot) shows, in
 * one place so an update started from one is seen by all. While an update runs the host is
 * asked every second and a half; otherwise the always-mounted surface re-reads it now and then.
 */
export interface AgentClisState {
  data: AgentClisResponse | null;
  checking: boolean;
  /** Providers whose update request is on its way to the host. */
  starting: readonly string[];
  /** A change of "skip permission checks" is on its way to the host. */
  savingBypass: boolean;
  /** Why the last request failed; the host's own refusals show on the CLI's update instead. */
  error: string | null;
}

const INITIAL: AgentClisState = {
  data: null,
  checking: false,
  starting: [],
  savingBypass: false,
  error: null,
};
const ACTIVE_POLL_MS = 1_500;

let state: AgentClisState = INITIAL;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let activePollMs = ACTIVE_POLL_MS;
const listeners = new Set<() => void>();

export const useAgentClis = (): AgentClisState => useSyncExternalStore(subscribe, () => state);

/** Reads the host's CLI status. Silent on failure: a panel that cannot load just shows nothing new. */
export const refreshAgentClis = async (): Promise<void> => {
  try {
    publish({ data: await getAgentClis() });
  } catch {
    // An unreachable host has nothing to show.
  }
  followActiveUpdates();
};

export const checkForCliUpdates = async (): Promise<void> => {
  publish({ checking: true, error: null });
  try {
    publish({ data: await checkAgentClis(), checking: false });
  } catch (error) {
    publish({ checking: false, error: messageOf(error, "Could not check for CLI updates.") });
  }
};

/** Starts the update on the host and follows it until it ends; the page never waits on it. */
export const startCliUpdate = async (provider: string): Promise<void> => {
  if (state.starting.includes(provider)) return;
  publish({ starting: [...state.starting, provider], error: null });
  try {
    await updateAgentCli(provider);
  } catch (error) {
    // A refusal (already running, unknown install method) is recorded on the CLI's update too.
    publish({ error: messageOf(error, "The update could not start.") });
  } finally {
    publish({ starting: state.starting.filter((candidate) => candidate !== provider) });
  }
  await refreshAgentClis();
};

/** Saves "skip permission checks" (host owner only), then reads back what the host now says. */
export const changeSkipPermissions = async (enabled: boolean): Promise<void> => {
  publish({ savingBypass: true, error: null });
  try {
    await setSkipPermissions(enabled);
  } catch (error) {
    publish({ error: messageOf(error, "Could not change the permission setting.") });
  } finally {
    publish({ savingBypass: false });
  }
  await refreshAgentClis();
};

/** Whether the agents this host starts now skip permission checks: the setting is on and can apply. */
export const skipsPermissions = (data: AgentClisResponse | null): boolean =>
  Boolean(data?.skipPermissions.enabled && data.skipPermissions.blockedReason === null);

/** CLIs with a newer version out and no update of theirs running: what the notice counts. */
export const pendingCliUpdates = (data: AgentClisResponse | null): AgentCliStatus[] =>
  (data?.clis ?? []).filter((cli) => cli.updateAvailable && !isUpdateRunning(cli));

export const isUpdateRunning = (cli: AgentCliStatus): boolean =>
  cli.update.state === "waiting" || cli.update.state === "updating";

/** Test seam: forget everything, and poll running updates every `pollMs`. */
export const resetAgentClisForTests = (pollMs = ACTIVE_POLL_MS): void => {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
  activePollMs = pollMs;
  state = INITIAL;
  for (const listener of listeners) listener();
};

const followActiveUpdates = (): void => {
  if (pollTimer !== null || !state.data?.clis.some(isUpdateRunning)) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void refreshAgentClis();
  }, activePollMs);
};

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const publish = (patch: Partial<AgentClisState>): void => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
