import type { ChatSessionMessage } from "../../api/client";

export const INITIAL_HISTORY_MESSAGES = 40;
export const HISTORY_MESSAGE_BATCH = 40;
export const MAX_COLLAPSED_USER_MESSAGE_LINES = 8;
export const MAX_COLLAPSED_USER_MESSAGE_LENGTH = 600;

export interface PreparedChatMessage {
  message: ChatSessionMessage;
  midRunHint?: "queued" | "steered";
  canRetry: boolean;
  previousUserCreatedAt: string | null;
  /** “Today” / “Yesterday” / “June 3” when this message starts a new calendar day (A5). */
  dayMarker: string | null;
}

export interface TimelineMinimapItem {
  id: string;
  userText: string;
  assistantText: string;
}

export const prepareMessages = (
  messages: ChatSessionMessage[],
  visibleStart: number,
  midRunHints: Record<string, "queued" | "steered">,
): { visible: PreparedChatMessage[]; deferred: PreparedChatMessage[] } => {
  const retriedRunIds = new Set<string>();
  const previousUserCreatedAt = previousUserTimestampByMessage(messages);
  const dayMarkers = dayMarkerByMessage(messages);
  const visible: PreparedChatMessage[] = [];
  const deferred: PreparedChatMessage[] = [];

  for (let index = messages.length - 1; index >= visibleStart; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.retryOfRunId) retriedRunIds.add(message.retryOfRunId);
    const prepared = buildPreparedMessage(message, {
      retriedRunIds,
      midRunHints,
      previousUserCreatedAt,
      dayMarkers,
    });
    (prepared.midRunHint ? deferred : visible).push(prepared);
  }

  visible.reverse();
  deferred.reverse();
  return { visible, deferred };
};

export const shouldCollapseUserMessage = (text: string): boolean =>
  text.trim().length > 0 &&
  (text.length > MAX_COLLAPSED_USER_MESSAGE_LENGTH ||
    text.split("\n").length > MAX_COLLAPSED_USER_MESSAGE_LINES);

export const formatRunDuration = (startedAt: string | null, endedAt: string): string | null => {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

export const formatWorkedLabel = (
  message: ChatSessionMessage,
  previousUserCreatedAt: string | null,
): string => {
  const duration = formatRunDuration(previousUserCreatedAt, message.createdAt);
  if (message.runStatus === "interrupted" || message.runStatus === "cancelled") {
    return duration ? `You stopped after ${duration}` : "You stopped this response";
  }
  return duration ? `Worked for ${duration}` : "Worked";
};

export const formatShortTimestamp = (isoDate: string): string => {
  const date = parseDate(isoDate);
  if (!date) return "";
  return shortTimeFormatter.format(date);
};

export const formatTimestampTooltip = (isoDate: string): string => {
  const date = parseDate(isoDate);
  if (!date) return "";
  return `${formatShortTimestamp(isoDate)}, ${date.getDate()}${ordinalSuffix(date.getDate())} ${monthFormatter.format(date)} ${date.getFullYear()}`;
};

export const isNearTimelineEnd = (element: HTMLElement, threshold = 96): boolean =>
  element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;

export const buildTimelineMinimapItems = (
  prepared: PreparedChatMessage[],
): TimelineMinimapItem[] => {
  const items: TimelineMinimapItem[] = [];
  let current: TimelineMinimapItem | null = null;
  for (const entry of prepared) {
    if (entry.message.role === "user") {
      current = {
        id: entry.message.id,
        userText: compactPreview(entry.message.content),
        assistantText: "",
      };
      items.push(current);
      continue;
    }
    if (current) current.assistantText = compactPreview(entry.message.content);
  }
  return items;
};

export const activityContentWithoutFinal = (message: ChatSessionMessage): string => {
  const content = message.activity?.content.trim() ?? "";
  return content && content !== message.content.trim() ? content : "";
};

export const hasRunActivity = (message: ChatSessionMessage): boolean =>
  Boolean(
    message.activity?.thinking.trim() ||
      activityContentWithoutFinal(message) ||
      (message.activity?.commandGroups.length ?? 0) > 0 ||
      continuityStatusLabel(message),
  );

export const continuityStatusLabel = (message?: ChatSessionMessage): string | null => {
  if (message?.runStatus && message.runStatus !== "completed") return runStatusLabel(message);
  if (message?.contextStrategy === "native_resume") return "Continued using native session";
  if (message?.contextStrategy === "aop_history") return "Continued from AOP conversation history";
  return null;
};

const buildPreparedMessage = (
  message: ChatSessionMessage,
  context: {
    retriedRunIds: Set<string>;
    midRunHints: Record<string, "queued" | "steered">;
    previousUserCreatedAt: Map<string, string | null>;
    dayMarkers: Map<string, string | null>;
  },
): PreparedChatMessage => {
  const midRunHint = resolveMidRunHint(message, context.midRunHints);
  return {
    message,
    ...(midRunHint ? { midRunHint } : {}),
    canRetry: canRetryStartupTimeout(message, context.retriedRunIds),
    previousUserCreatedAt: context.previousUserCreatedAt.get(message.id) ?? null,
    dayMarker: context.dayMarkers.get(message.id) ?? null,
  };
};

const previousUserTimestampByMessage = (
  messages: ChatSessionMessage[],
): Map<string, string | null> => {
  const result = new Map<string, string | null>();
  let previousUserCreatedAt: string | null = null;
  for (const message of messages) {
    if (message.role === "user") previousUserCreatedAt = message.createdAt;
    result.set(message.id, previousUserCreatedAt);
  }
  return result;
};

const dayMarkerByMessage = (messages: ChatSessionMessage[]): Map<string, string | null> => {
  const result = new Map<string, string | null>();
  let previousDate: Date | null = null;
  for (const message of messages) {
    const date = parseDate(message.createdAt);
    result.set(message.id, date ? dayMarkerLabel(date, previousDate) : null);
    if (date) previousDate = date;
  }
  return result;
};

const dayMarkerLabel = (date: Date, previousDate: Date | null): string | null => {
  if (previousDate && sameLocalDay(date, previousDate)) return null;
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameLocalDay(date, today)) return "Today";
  if (sameLocalDay(date, yesterday)) return "Yesterday";
  return date.getFullYear() === today.getFullYear()
    ? monthDayFormatter.format(date)
    : fullDateFormatter.format(date);
};

const sameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const resolveMidRunHint = (
  message: ChatSessionMessage,
  midRunHints: Record<string, "queued" | "steered">,
): "queued" | "steered" | undefined => {
  if (message.runStatus) return undefined;
  // A stored disposition the server has already moved off "queued"/"steered" means
  // the turn was claimed — an optimistic hint must not outlive that.
  if (
    message.disposition &&
    message.disposition !== "queued" &&
    message.disposition !== "steered"
  ) {
    return undefined;
  }
  return midRunHints[message.id] ?? message.disposition;
};

const canRetryStartupTimeout = (message: ChatSessionMessage, retriedRunIds: Set<string>): boolean =>
  message.failureKind === "startup_timeout" &&
  Boolean(message.runId) &&
  !retriedRunIds.has(message.runId ?? "");

const runStatusLabel = (message: ChatSessionMessage): string => {
  if (message.runStatus === "interrupted") return "Interrupted to apply your next message";
  if (message.runStatus === "cancelled" && message.interruptionKind === "reset") {
    return "Cancelled by runtime reset";
  }
  if (message.runStatus === "cancelled") return "Cancelled by Stop";
  if (message.failureKind === "startup_timeout") return "Runtime startup timed out";
  return "Runtime failed";
};

const compactPreview = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 160);
const parseDate = (isoDate: string): Date | null => {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
};
const shortTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long" });
const monthDayFormatter = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});
const ordinalSuffix = (day: number): string => {
  const lastTwo = day % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  if (day % 10 === 3) return "rd";
  return "th";
};
