import { useSyncExternalStore } from "react";
import type { ChatSessionSummary } from "../api/client";

export interface RailRepoGroup {
  repoId: string;
  name: string;
  sessions: ChatSessionSummary[];
}

export type RailMenuAction = "rename" | "pin" | "settle" | "unsettle" | "delete";

/**
 * The props the Sessions workspace publishes for the app rail. The rail is
 * shell chrome; the thread-list data/actions stay owned by the sessions
 * workspace (PLAN §6.1: "existing thread-list logic").
 */
export interface RailProps {
  groups: RailRepoGroup[];
  /** General (repo-less) sessions. */
  tasks: ChatSessionSummary[];
  settled: ChatSessionSummary[];
  activeSessionId: string | null;
  connected: boolean;
  workflowCount: number;
  onSelect: (sessionId: string) => void;
  onNewSession: (repoId: string) => void;
  onNewTask: () => void;
  onAttachRepo: () => void;
  onAction: (sessionId: string, action: RailMenuAction) => void;
}

let current: RailProps | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setRailProps = (props: RailProps | null): void => {
  current = props;
  for (const listener of listeners) listener();
};

export const useRailProps = (): RailProps | null => useSyncExternalStore(subscribe, () => current);

/** Non-hook accessor (tests, one-shot reads). */
export const getRailProps = (): RailProps | null => current;

/** Test hook: reset between tests. */
export const resetRailProps = (): void => setRailProps(null);
