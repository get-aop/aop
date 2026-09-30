import { parseRawJsonlContent, type RawProviderEvent } from "@aop/llm-provider";

/*
 * Recognises a Claude Code run that a rate or usage limit refused, from the run's stream-json log.
 *
 * The shapes below come from Claude Code's documentation and third-party reports, not from a
 * recording of the real CLI, which AOP's tests must never run:
 * - `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":<epoch seconds>,
 *   "overageStatus":...}}`; a `rejected` status that overage covers does not stop the run.
 * - an assistant event with `"error":"rate_limit"` holding the user-facing text (Agent SDK
 *   reference: SDKAssistantMessageError).
 * - a `result` event with `is_error: true` and `api_error_status: 429` (SDKResultMessage).
 * - the text `You've hit your session limit · resets 3:45pm`, or `... weekly limit · resets Mon
 *   12:00am` (Claude Code error reference): a local wall-clock time, with no zone.
 * What a real run was recorded writing (harness, Claude Code 2.1.285, Max login) is only the
 * warning: `rate_limit_info.status` is `allowed_warning` once a window passes a threshold, and it
 * is not a limit. A refusal itself has never been seen.
 * The exit code is not relied on: a limit is recognised from what the log says, whatever the CLI
 * exited with.
 */

/** How long a limit with no usable reset time waits before the session tries again. */
export const RATE_LIMIT_FALLBACK_MS = 15 * 60_000;
/** The wait when the CLI's reset time is already past: the limit is not over, so this is a retry, not a reset. */
export const RATE_LIMIT_PAST_RESET_MS = 30_000;
/** Past the reset, so the retry does not land on the boundary. */
const RESET_MARGIN_MS = 1_000;
/** No plan window lasts longer, so a farther time is a misreading. */
const MAX_WAIT_MS = 8 * 24 * 3_600_000;
/** A wall-clock reset a minute ago is the reset that just happened, not tomorrow's. */
const CLOCK_GRACE_MS = 60_000;
const MESSAGE_MAX = 300;
const EPOCH_MS_THRESHOLD = 1e11;

export interface RateLimitHit {
  /** The CLI's own words, e.g. "You've hit your session limit · resets 3:45pm". */
  message: string;
  /** When the session resumes by itself, ISO-8601: the reset, or a retry time when there is none. */
  resumesAt: string;
  /** True when `resumesAt` follows the CLI's reset time. */
  resetKnown: boolean;
}

const LIMIT_TEXT = /you['’]ve hit your (?:[\w.-]+ )?limit|usage limit reached|rate limit/i;
const RESET_TEXT =
  /resets?\s+(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The rate limit that ended the run in `rawJsonl` (its log, or the end of it), or null. */
export const detectRateLimit = (rawJsonl: string, now: Date = new Date()): RateLimitHit | null => {
  const events = parseRawJsonlContent(rawJsonl).entries.map(({ event }) => event);
  const evidence = gatherEvidence(events);
  if (!isRateLimited(evidence)) return null;

  const resetAt = evidence.resetsAtMs ?? resetFromText(evidence.text, now);
  const wait = planResume(resetAt, now);
  return {
    message:
      summarize(evidence.text) || `Rate limited${evidence.status === 429 ? " (HTTP 429)" : ""}`,
    resumesAt: new Date(wait.at).toISOString(),
    resetKnown: wait.known,
  };
};

/** What the user is told, in the run's reply and the thread's status line. */
export const describeRateLimit = (hit: RateLimitHit, now: Date = new Date()): string => {
  const verb = hit.resetKnown ? "Resuming automatically" : "Retrying automatically";
  return `Paused: ${hit.message}. ${verb} at ${formatTime(new Date(hit.resumesAt), now)}.`;
};

interface Evidence {
  /** `is_error` of the run's last result; null when the log has none. */
  resultIsError: boolean | null;
  status: number | null;
  flagged: boolean;
  rejectedEvent: boolean;
  resetsAtMs: number | null;
  /** What the CLI said, the result's text first, then the flagged reply's. */
  text: string;
}

const gatherEvidence = (events: RawProviderEvent[]): Evidence => {
  const result = events.findLast((event) => event.type === "result");
  const limit = events.findLast(isRejectedLimitEvent);
  const flagged = events.findLast(
    (event) => event.type === "assistant" && event.error === "rate_limit",
  );
  const texts = [result?.result, flagged ? assistantText(flagged) : null];
  return {
    resultIsError: result ? result.is_error === true : null,
    status: typeof result?.api_error_status === "number" ? result.api_error_status : null,
    flagged: flagged !== undefined,
    rejectedEvent: limit !== undefined,
    resetsAtMs: limit ? epochMs(record(limit.rate_limit_info).resetsAt) : null,
    text: texts.filter((text) => typeof text === "string" && text.trim()).join("\n"),
  };
};

const isRateLimited = (evidence: Evidence): boolean => {
  const { resultIsError, status, flagged, rejectedEvent, text } = evidence;
  // A log with no result means the process died; a refusal it logged first still explains why.
  if (resultIsError === null) return flagged || rejectedEvent;
  if (!resultIsError) return false;
  return status === 429 || flagged || rejectedEvent || LIMIT_TEXT.test(text);
};

// A `rejected` window that paid overage covers lets the run go on.
const isRejectedLimitEvent = (event: RawProviderEvent): boolean => {
  if (event.type !== "rate_limit_event") return false;
  const info = record(event.rate_limit_info);
  return (
    info.status === "rejected" &&
    !["allowed", "allowed_warning"].includes(String(info.overageStatus))
  );
};

const assistantText = (event: RawProviderEvent): string | null => {
  const content = record(event.message).content;
  if (!Array.isArray(content)) return null;
  const block = content.find((part) => record(part).type === "text");
  const text = record(block).text;
  return typeof text === "string" ? text : null;
};

const epochMs = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value >= EPOCH_MS_THRESHOLD ? value : value * 1000;
};

/** `resets 3:45pm` or `resets Mon 12:00am`, read as the next such local time. */
const resetFromText = (text: string, now: Date): number | null => {
  const match = RESET_TEXT.exec(text);
  if (!match) return null;
  const [, weekday, hour, minute, meridiem] = match;
  const at = new Date(now);
  at.setHours(
    (Number(hour) % 12) + (meridiem?.toLowerCase() === "pm" ? 12 : 0),
    Number(minute ?? 0),
    0,
    0,
  );
  const floor = now.getTime() - CLOCK_GRACE_MS;
  const day = weekday ? WEEKDAYS.indexOf(weekday.toLowerCase()) : null;
  if (day === null) {
    if (at.getTime() < floor) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  at.setDate(at.getDate() + ((day - at.getDay() + 7) % 7));
  if (at.getTime() < floor) at.setDate(at.getDate() + 7);
  return at.getTime();
};

const planResume = (resetAt: number | null, now: Date): { at: number; known: boolean } => {
  const nowMs = now.getTime();
  if (resetAt === null) return { at: nowMs + RATE_LIMIT_FALLBACK_MS, known: false };
  if (resetAt <= nowMs) return { at: nowMs + RATE_LIMIT_PAST_RESET_MS, known: false };
  return { at: Math.min(resetAt, nowMs + MAX_WAIT_MS) + RESET_MARGIN_MS, known: true };
};

const summarize = (text: string): string => {
  const line = text.split("\n").find((candidate) => candidate.trim()) ?? "";
  const trimmed = line.trim();
  return trimmed.length <= MESSAGE_MAX ? trimmed : `${trimmed.slice(0, MESSAGE_MAX - 1)}…`;
};

// Written out, not left to the locale's formatter, so the text is the same on every host.
const formatTime = (at: Date, now: Date): string => {
  const clock = `${at.getHours() % 12 || 12}:${String(at.getMinutes()).padStart(2, "0")} ${at.getHours() < 12 ? "AM" : "PM"}`;
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? clock : `${WEEKDAY_NAMES[at.getDay()]} ${clock}`;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
