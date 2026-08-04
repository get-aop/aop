import { BACKGROUND_TASK_LIMIT, type ChatDelegationRunDto } from "@aop/common";
import { useSyncExternalStore } from "react";
import { listActiveChatDelegations, listChatDelegations } from "../../api/client";

export interface DelegationLiveOutput {
  thinking: string;
  content: string;
  commandGroups: Array<{
    id: string;
    commands: Array<{
      id: string;
      command: string;
      status: "running" | "done" | "failed";
      exitCode?: number | null;
    }>;
  }>;
}

export interface DelegationCardState {
  delegation: ChatDelegationRunDto;
  /** Live specialist output while the run is active (streamed). */
  live: DelegationLiveOutput | null;
  dismissed: boolean;
}

/** Session-stream event shapes the center understands (forwarded or self-streamed). */
export interface DelegationSessionEvent {
  type: string;
  sessionId: string;
  hostRunId?: string;
  delegationId?: string;
  delegation?: ChatDelegationRunDto;
  thinking?: string;
  content?: string;
  commandGroups?: DelegationLiveOutput["commandGroups"];
  message?: {
    runId?: string | null;
    runStatus?: string | null;
  };
}

const DISMISSED_STORAGE_KEY = "aop:delegation-cards-dismissed";
const DISMISSED_STORAGE_LIMIT = 200;

const cards = new Map<string, DelegationCardState>();
const streams = new Map<string, EventSource>();
const listeners = new Set<() => void>();
let visibleSnapshot: DelegationCardState[] = [];
let allSnapshot: DelegationCardState[] = [];
let openDelegationId: string | null = null;
/** Cards only show for the session that owns them; null hides the stack. */
let focusedSessionId: string | null = null;
let initPromise: Promise<void> | null = null;

const emit = (): void => {
  allSnapshot = [...cards.values()];
  visibleSnapshot = computeVisible();
  for (const listener of listeners) listener();
};

const computeVisible = (): DelegationCardState[] => {
  const focused = [...cards.values()].filter(
    (card) => focusedSessionId !== null && card.delegation.sessionId === focusedSessionId,
  );
  const recentBackgroundTaskIds = new Set(
    focused
      .filter(
        (card) =>
          card.delegation.kind === "background-task" && !isBackgroundTaskFromTerminalHost(card),
      )
      .sort((left, right) => right.delegation.startedAt.localeCompare(left.delegation.startedAt))
      .slice(0, BACKGROUND_TASK_LIMIT)
      .map((card) => card.delegation.id),
  );

  return focused
    .filter(
      (card) =>
        !card.dismissed &&
        !isBackgroundTaskFromTerminalHost(card) &&
        (card.delegation.kind !== "background-task" ||
          recentBackgroundTaskIds.has(card.delegation.id)),
    )
    .sort((left, right) => {
      const leftActive = left.delegation.status === "active" ? 0 : 1;
      const rightActive = right.delegation.status === "active" ? 0 : 1;
      if (leftActive !== rightActive) return leftActive - rightActive;
      return right.delegation.startedAt.localeCompare(left.delegation.startedAt);
    });
};

const isBackgroundTaskFromTerminalHost = (card: DelegationCardState): boolean =>
  card.delegation.kind === "background-task" && card.delegation.hostRunStatus !== "running";

const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const readDismissed = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(DISMISSED_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
};

const writeDismissed = (ids: Set<string>): void => {
  const trimmed = [...ids].slice(-DISMISSED_STORAGE_LIMIT);
  storage()?.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(trimmed));
};

/** Mirror server toDelegationDto: active only while the host turn is running. */
const withEffectiveStatus = (delegation: ChatDelegationRunDto): ChatDelegationRunDto =>
  delegation.status === "active" && delegation.hostRunStatus !== "running"
    ? { ...delegation, status: "cancelled" }
    : delegation;

const upsert = (delegation: ChatDelegationRunDto): void => {
  const effective = withEffectiveStatus(delegation);
  const existing = cards.get(effective.id);
  const dismissed = readDismissed();
  // Failed runs re-surface until explicitly acknowledged.
  if (effective.status === "failed" && dismissed.has(effective.id)) {
    dismissed.delete(effective.id);
    writeDismissed(dismissed);
  }
  cards.set(effective.id, {
    delegation: effective,
    live: existing?.live ?? null,
    dismissed: dismissed.has(effective.id),
  });
};

const applyProgress = (event: DelegationSessionEvent): void => {
  if (!event.delegationId || !cards.has(event.delegationId)) return;
  const card = cards.get(event.delegationId);
  if (!card) return;
  cards.set(event.delegationId, {
    ...card,
    live: {
      thinking: event.thinking ?? "",
      content: event.content ?? "",
      commandGroups: event.commandGroups ?? [],
    },
  });
};

/** Keep one stream per session with active delegations; close the rest. */
const reconcileStreams = (): void => {
  const activeSessionIds = new Set(
    [...cards.values()]
      .filter(
        (card) =>
          card.delegation.status === "active" && card.delegation.hostRunStatus === "running",
      )
      .map((card) => card.delegation.sessionId),
  );
  for (const [sessionId, source] of streams) {
    if (!activeSessionIds.has(sessionId)) {
      source.close();
      streams.delete(sessionId);
    }
  }
  for (const sessionId of activeSessionIds) {
    if (streams.has(sessionId)) continue;
    const source = new EventSource(`/api/chat-sessions/${sessionId}/stream`);
    for (const type of ["delegation-updated", "delegation-progress", "assistant-final"]) {
      source.addEventListener(type, (raw) => {
        try {
          ingestDelegationSessionEvent(JSON.parse(raw.data) as DelegationSessionEvent);
        } catch {
          // Ignore malformed event payloads.
        }
      });
    }
    streams.set(sessionId, source);
  }
};

export const ingestDelegationSessionEvent = (event: DelegationSessionEvent): void => {
  if (event.type === "delegation-updated" && event.delegation) {
    upsert(event.delegation);
    reconcileStreams();
    emit();
    return;
  }
  if (event.type === "delegation-progress") {
    applyProgress(event);
    emit();
    return;
  }
  if (event.type === "assistant-final") {
    const runId = event.message?.runId;
    const runStatus = event.message?.runStatus;
    if (runId && runStatus) {
      markDelegationHostRunTerminal(runId, runStatus);
      return;
    }
    reconcileSessionDelegationsAfterHostFinal(event.sessionId);
  }
};

/** Hide model-spawned task cards as soon as their owning chat turn finishes. */
export const markDelegationHostRunTerminal = (hostRunId: string, hostRunStatus: string): void => {
  if (!hostRunId || hostRunStatus === "running") return;
  let changed = false;
  for (const [id, card] of cards) {
    if (card.delegation.hostRunId !== hostRunId) continue;
    cards.set(id, {
      ...card,
      delegation: withEffectiveStatus({ ...card.delegation, hostRunStatus }),
    });
    changed = true;
  }
  if (!changed) return;
  const openCard = openDelegationId ? cards.get(openDelegationId) : null;
  if (openCard && isBackgroundTaskFromTerminalHost(openCard)) openDelegationId = null;
  reconcileStreams();
  emit();
};

/**
 * Rebuild card state from persisted runs (refresh/reconnect) and start live
 * streams. Idempotent; concurrent callers share one fetch.
 */
export const initDelegationCenter = async (): Promise<void> => {
  initPromise ??= listActiveChatDelegations()
    .then((delegations) => {
      for (const delegation of delegations) upsert(delegation);
      reconcileStreams();
      emit();
    })
    .catch(() => {
      initPromise = null;
    });
  return initPromise;
};

/** Dismiss a card visually. Never cancels the delegated runtime. */
export const dismissDelegationCard = (delegationId: string): void => {
  const card = cards.get(delegationId);
  if (!card) return;
  const dismissed = readDismissed();
  dismissed.add(delegationId);
  writeDismissed(dismissed);
  cards.set(delegationId, { ...card, dismissed: true });
  emit();
};

export const getDelegationCards = (): DelegationCardState[] => visibleSnapshot;

/** Unfiltered card states (selectors and stream lifecycle work off these). */
export const getAllDelegationCards = (): DelegationCardState[] => allSnapshot;

export const getDelegationCard = (delegationId: string): DelegationCardState | null =>
  cards.get(delegationId) ?? null;

/** Scope card visibility to one session (SessionsPage syncs its open session). */
export const setDelegationSessionFocus = (sessionId: string | null): void => {
  if (focusedSessionId === sessionId) return;
  focusedSessionId = sessionId;
  emit();
  // Historical sessions may predate live tracking — fetch (and server-backfill)
  // that session's cards when the operator opens it.
  if (sessionId) void loadSessionDelegations(sessionId);
};

/** Pull session-scoped cards (triggers server log backfill for old runs). */
const loadSessionDelegations = async (sessionId: string): Promise<void> => {
  try {
    const delegations = await listChatDelegations(sessionId);
    for (const delegation of delegations) upsert(delegation);
    reconcileStreams();
    emit();
  } catch {
    // Keep whatever cards we already have if the rebuild fails.
  }
};

/** Active delegations for one session (what the chat thread advertises). */
export const selectActiveSessionDelegations = (
  source: DelegationCardState[],
  sessionId: string,
): DelegationCardState[] =>
  source.filter(
    (card) =>
      card.delegation.sessionId === sessionId &&
      card.delegation.status === "active" &&
      // Match server toDelegationDto: specialists cannot stay live after the host ends.
      card.delegation.hostRunStatus === "running",
  );

/**
 * When the host turn ends, any still-active cards for that session are no longer live.
 * Heals races where a terminal cascade event was missed or overwritten client-side.
 */
export const reconcileSessionDelegationsAfterHostFinal = (sessionId: string): void => {
  let changed = false;
  for (const [id, card] of cards) {
    if (card.delegation.sessionId !== sessionId || card.delegation.status !== "active") continue;
    cards.set(id, {
      ...card,
      delegation: {
        ...card.delegation,
        status: "cancelled",
        hostRunStatus:
          card.delegation.hostRunStatus === "running" ? "completed" : card.delegation.hostRunStatus,
      },
    });
    changed = true;
  }
  if (!changed) return;
  reconcileStreams();
  emit();
};

/** The shared expanded-detail target: card clicks and chat-row clicks both set it. */
export const getOpenDelegationId = (): string | null => openDelegationId;

export const openDelegationDetail = (delegationId: string): void => {
  if (openDelegationId === delegationId) return;
  openDelegationId = delegationId;
  emit();
};

export const closeDelegationDetail = (): void => {
  if (openDelegationId === null) return;
  openDelegationId = null;
  emit();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Visible delegation cards, active first then newest. */
export const useDelegationCards = (): DelegationCardState[] =>
  useSyncExternalStore(subscribe, getDelegationCards, () => []);

/** All tracked delegations regardless of focus/dismissal (chat-thread selector). */
export const useAllDelegationCards = (): DelegationCardState[] =>
  useSyncExternalStore(subscribe, getAllDelegationCards, () => []);

export const useOpenDelegationId = (): string | null =>
  useSyncExternalStore(subscribe, getOpenDelegationId, () => null);

/** Test helper: drop all state and close streams. */
export const resetDelegationCenter = (): void => {
  for (const source of streams.values()) source.close();
  streams.clear();
  cards.clear();
  openDelegationId = null;
  focusedSessionId = null;
  initPromise = null;
  emit();
};
