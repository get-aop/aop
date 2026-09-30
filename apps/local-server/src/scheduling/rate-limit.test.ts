import { describe, expect, test } from "bun:test";
import {
  describeRateLimit,
  detectRateLimit,
  RATE_LIMIT_FALLBACK_MS,
  RATE_LIMIT_PAST_RESET_MS,
} from "./rate-limit.ts";

// Local time on purpose: Claude Code prints the reset as a wall-clock time without a zone.
const NOW = new Date(2026, 8, 30, 14, 0, 0); // Wednesday 14:00
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

const jsonl = (...events: object[]): string =>
  events.map((event) => JSON.stringify(event)).join("\n");

const init = { type: "system", subtype: "init", session_id: "s1" };
const limitEvent = (info: object = {}) => ({
  type: "rate_limit_event",
  rate_limit_info: {
    status: "rejected",
    resetsAt: NOW_SECONDS + 3600,
    rateLimitType: "five_hour",
    overageStatus: "rejected",
    ...info,
  },
});
const flaggedReply = (text: string) => ({
  type: "assistant",
  error: "rate_limit",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const errorResult = (fields: object = {}) => ({
  type: "result",
  subtype: "success",
  is_error: true,
  api_error_status: 429,
  result: "You've hit your session limit · resets 3:45pm",
  ...fields,
});

describe("detectRateLimit", () => {
  // Recorded from Claude Code 2.1.285 on a Max login by the real-runtime harness: every ordinary
  // run writes this while a window is past a threshold. It is a warning, not a refusal.
  test("the allowed_warning event a real run writes is not a limit", () => {
    const warning = {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed_warning",
        resetsAt: NOW_SECONDS + 7 * 86_400,
        rateLimitType: "seven_day",
        utilization: 0.86,
        isUsingOverage: false,
        surpassedThreshold: 0.75,
        unifiedWindows: {
          five_hour: { utilization: 0.06, resetsAt: NOW_SECONDS + 18_000 },
          seven_day: { utilization: 0.86, resetsAt: NOW_SECONDS + 7 * 86_400 },
        },
      },
    };
    const success = {
      type: "result",
      subtype: "success",
      is_error: false,
      api_error_status: null,
      result: "done",
    };

    expect(detectRateLimit(jsonl(init, warning, success), NOW)).toBeNull();
    // Even a run that then failed for another reason is not blamed on the warning.
    expect(
      detectRateLimit(jsonl(init, warning, { ...success, is_error: true, result: "boom" }), NOW),
    ).toBeNull();
  });

  test("reads the reset from the rate limit event: epoch seconds, plus a margin", () => {
    const hit = detectRateLimit(jsonl(init, limitEvent(), flaggedReply("x"), errorResult()), NOW);

    expect(hit).toEqual({
      message: "You've hit your session limit · resets 3:45pm",
      resumesAt: new Date(NOW.getTime() + 3_601_000).toISOString(),
      resetKnown: true,
    });
  });

  test("takes a reset in milliseconds as milliseconds", () => {
    const event = limitEvent({ resetsAt: NOW.getTime() + 7_200_000 });

    const hit = detectRateLimit(jsonl(event, errorResult()), NOW);

    expect(hit?.resumesAt).toBe(new Date(NOW.getTime() + 7_201_000).toISOString());
  });

  test("without an event, reads today's wall-clock reset from the text", () => {
    const hit = detectRateLimit(jsonl(errorResult()), NOW);

    expect(hit).toMatchObject({ resumesAt: new Date(2026, 8, 30, 15, 45, 1).toISOString() });
    expect(hit?.resetKnown).toBe(true);
  });

  test("a wall-clock reset that has passed today means tomorrow's", () => {
    const evening = new Date(2026, 8, 30, 16, 0, 0);

    const hit = detectRateLimit(jsonl(errorResult()), evening);

    expect(hit?.resumesAt).toBe(new Date(2026, 9, 1, 15, 45, 1).toISOString());
  });

  test("a weekly limit names a weekday and resumes on its next occurrence", () => {
    const text = "You've hit your weekly limit · resets Mon 12:00am";

    const hit = detectRateLimit(jsonl(errorResult({ result: text })), NOW);

    expect(hit?.resumesAt).toBe(new Date(2026, 9, 5, 0, 0, 1).toISOString());
  });

  test("reads a limit for one model and an hour with no minutes", () => {
    const hit = detectRateLimit(
      jsonl(errorResult({ result: "You've hit your Opus limit · resets 5pm" })),
      NOW,
    );

    expect(hit?.resumesAt).toBe(new Date(2026, 8, 30, 17, 0, 1).toISOString());
  });

  test("a reset that is not in the future is a retry in half a minute, not a reset", () => {
    const stale = limitEvent({ resetsAt: NOW_SECONDS - 5 });

    const hit = detectRateLimit(jsonl(stale, errorResult()), NOW);

    expect(hit).toMatchObject({
      resumesAt: new Date(NOW.getTime() + RATE_LIMIT_PAST_RESET_MS).toISOString(),
      resetKnown: false,
    });
  });

  test("a reset half a second away is still a reset: it resumes just after it", () => {
    const soon = limitEvent({ resetsAt: NOW.getTime() / 1000 + 0.5 });

    const hit = detectRateLimit(jsonl(soon, errorResult()), NOW);

    expect(hit).toMatchObject({
      resumesAt: new Date(NOW.getTime() + 1_500).toISOString(),
      resetKnown: true,
    });
  });

  test("a wall-clock reset a few seconds ago is the reset that just happened", () => {
    const justAfter = new Date(2026, 8, 30, 15, 45, 20);

    const hit = detectRateLimit(jsonl(errorResult()), justAfter);

    expect(hit?.resumesAt).toBe(
      new Date(justAfter.getTime() + RATE_LIMIT_PAST_RESET_MS).toISOString(),
    );
    expect(hit?.resetKnown).toBe(false);
  });

  test("a 429 with no reset time retries after the fallback wait", () => {
    const text = "API Error: Request rejected (429) · this may be a temporary capacity issue.";

    const hit = detectRateLimit(jsonl(errorResult({ result: text })), NOW);

    expect(hit).toEqual({
      message: text,
      resumesAt: new Date(NOW.getTime() + RATE_LIMIT_FALLBACK_MS).toISOString(),
      resetKnown: false,
    });
  });

  test("a limit is recognised from its text alone, whatever the status", () => {
    const hit = detectRateLimit(jsonl(errorResult({ api_error_status: null })), NOW);

    expect(hit?.resetKnown).toBe(true);
  });

  test("a flagged reply is enough when the process died before a result", () => {
    const hit = detectRateLimit(
      jsonl(init, flaggedReply("You've hit your session limit · resets 5pm")),
      NOW,
    );

    expect(hit?.resumesAt).toBe(new Date(2026, 8, 30, 17, 0, 1).toISOString());
  });

  test("a rejected window that overage covers does not stop the run", () => {
    const covered = limitEvent({ overageStatus: "allowed" });

    expect(detectRateLimit(jsonl(covered, errorResult()), NOW)).toMatchObject({
      resetKnown: true,
    });
    expect(
      detectRateLimit(jsonl(covered, { type: "result", subtype: "success", is_error: false }), NOW),
    ).toBeNull();
  });

  test("a run that ended well is not limited, whatever it logged on the way", () => {
    const ok = { type: "result", subtype: "success", is_error: false, result: "Done." };

    expect(detectRateLimit(jsonl(limitEvent(), ok), NOW)).toBeNull();
    expect(detectRateLimit(jsonl(flaggedReply("rate limit"), ok), NOW)).toBeNull();
  });

  test("an ordinary failure, a spend limit and a plain log are not rate limits", () => {
    const failure = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: ["boom"],
    };
    const spend = errorResult({
      api_error_status: null,
      result: "You've hit your monthly spend limit · raise it at claude.ai/settings/usage",
    });

    expect(detectRateLimit(jsonl(init, failure), NOW)).toBeNull();
    expect(detectRateLimit(jsonl(init, spend), NOW)).toBeNull();
    expect(detectRateLimit("", NOW)).toBeNull();
    expect(detectRateLimit("not json\n{broken", NOW)).toBeNull();
  });

  test("a reset farther out than any plan window is clamped", () => {
    const far = limitEvent({ resetsAt: NOW_SECONDS + 90 * 86_400 });

    const hit = detectRateLimit(jsonl(far, errorResult({ result: "limit" })), NOW);

    expect(Date.parse(hit?.resumesAt ?? "") - NOW.getTime()).toBe(8 * 86_400_000 + 1000);
  });
});

describe("describeRateLimit", () => {
  test("says when the session resumes, with the weekday when it is not today", () => {
    const today = {
      message: "You've hit your limit",
      resumesAt: new Date(2026, 8, 30, 15, 45).toISOString(),
      resetKnown: true,
    };
    const later = { ...today, resumesAt: new Date(2026, 9, 5, 0, 0).toISOString() };

    expect(describeRateLimit(today, NOW)).toBe(
      "Paused: You've hit your limit. Resuming automatically at 3:45 PM.",
    );
    expect(describeRateLimit(later, NOW)).toBe(
      "Paused: You've hit your limit. Resuming automatically at Mon 12:00 AM.",
    );
  });

  test("calls a wait with no known reset a retry", () => {
    const hit = {
      message: "Rate limited",
      resumesAt: new Date(2026, 8, 30, 14, 15).toISOString(),
      resetKnown: false,
    };

    expect(describeRateLimit(hit, NOW)).toBe(
      "Paused: Rate limited. Retrying automatically at 2:15 PM.",
    );
  });
});
