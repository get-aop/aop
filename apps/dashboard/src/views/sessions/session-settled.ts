import type { ChatSessionSummary, SessionPullRequestState } from "../../api/client";

const DAY_MS = 24 * 60 * 60 * 1_000;

export const DEFAULT_AUTO_SETTLE_AFTER_DAYS = 3;

export interface SessionSettledOptions {
  now: string;
  autoSettleAfterDays?: number | null;
  pullRequestState?: SessionPullRequestState | null;
}

export const isSessionLifecycleBusy = (
  session: Pick<ChatSessionSummary, "assistantActive" | "assistantLifecycle">,
): boolean =>
  session.assistantLifecycle === undefined
    ? session.assistantActive
    : session.assistantLifecycle !== "idle";

export const canSettleSession = (
  session: Pick<
    ChatSessionSummary,
    "assistantActive" | "assistantLifecycle" | "hasPendingApproval"
  >,
): boolean => !session.hasPendingApproval && !isSessionLifecycleBusy(session);

/**
 * Resolve the effective settled state. Blocked work remains active; otherwise
 * an explicit override wins before PR and inactivity-based auto-settlement.
 */
export const isSessionSettled = (
  session: Pick<
    ChatSessionSummary,
    | "assistantActive"
    | "assistantLifecycle"
    | "hasPendingApproval"
    | "lastActivityAt"
    | "settledOverride"
  >,
  options: SessionSettledOptions,
): boolean => {
  if (!canSettleSession(session)) return false;
  if (session.settledOverride === "settled") return true;
  if (session.settledOverride === "active") return false;

  if (options.pullRequestState === "closed" || options.pullRequestState === "merged") return true;

  const autoSettleAfterDays =
    options.autoSettleAfterDays === undefined
      ? DEFAULT_AUTO_SETTLE_AFTER_DAYS
      : options.autoSettleAfterDays;
  if (autoSettleAfterDays === null || session.lastActivityAt == null) return false;

  const lastActivityAt = Date.parse(session.lastActivityAt);
  const now = Date.parse(options.now);
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return false;

  return lastActivityAt < now - autoSettleAfterDays * DAY_MS;
};
