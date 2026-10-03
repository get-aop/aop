import { type CuaLeaseState, cuaHolderName } from "@aop/common";
import { useLiveViewState } from "./live-view-store";

/**
 * Where a thread stands with the host's computer-use lease: it holds it, it waits in line for it
 * (`position` 1 is next), or it has nothing to do with it.
 */
export type ThreadLeasePlace = { state: "holding" } | { state: "waiting"; position: number };

/**
 * The computer-use lease as the live view's status last carried it; null until the host answered.
 * The always-mounted live view keeps that status fresh, so reading it costs no request.
 */
export const useCuaLease = (): CuaLeaseState | null => useLiveViewState().status?.lease ?? null;

/** The lease's place for one thread, or null when it neither holds nor waits for it. */
export const threadLeasePlace = (
  lease: CuaLeaseState | null,
  threadId: string,
): ThreadLeasePlace | null => {
  if (!lease) return null;
  const { holder } = lease;
  if (holder?.kind === "thread" && holder.threadId === threadId) return { state: "holding" };
  const waiter = lease.queue.find((entry) => entry.threadId === threadId);
  return waiter ? { state: "waiting", position: waiter.position } : null;
};

/** "Computer use: Check the login page · 2 waiting", or null when nobody holds or waits for it. */
export const leaseSummary = (lease: CuaLeaseState | null): string | null => {
  if (!lease || (!lease.holder && lease.queue.length === 0)) return null;
  const holder = lease.holder ? cuaHolderName(lease.holder) : "free";
  return `Computer use: ${holder}${waitingCount(lease)}`;
};

/** " · 2 waiting", or nothing when the line is empty. */
export const waitingCount = (lease: CuaLeaseState): string =>
  lease.queue.length > 0 ? ` · ${lease.queue.length} waiting` : "";
