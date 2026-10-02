import { describe, expect, test } from "bun:test";
import { readPlanLimits } from "./plan-limits-event.ts";

// Recorded from Claude Code on a Max login (AOP run logs, 2026-10-01).
const RECORDED =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1790909400,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0.43,"resetsAt":1790909400},"seven_day":{"utilization":0.32,"resetsAt":1791241200}}},"uuid":"c6d751b8-2041-4d90-8fa5-bcc786e1554f","session_id":"9d4acb58-7af5-49c6-a6a1-425538977652"}';
const RECORDED_WARNING =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1790960400,"rateLimitType":"seven_day","utilization":0.98,"isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.16,"resetsAt":1790820600},"seven_day":{"utilization":0.98,"resetsAt":1790960400}}},"uuid":"c90ed42f-169c-4be3-ba10-a78a610376ec","session_id":"600f195e-b80d-45bc-be5c-2c5bef133270"}';

const event = (info: Record<string, unknown>) =>
  JSON.stringify({ type: "rate_limit_event", rate_limit_info: info });

describe("readPlanLimits", () => {
  test("reads both windows of a recorded event, as percentages and reset instants", () => {
    expect(readPlanLimits(RECORDED)).toEqual({
      fiveHour: { usedPercent: 43, resetsAt: "2026-10-02T02:50:00.000Z" },
      sevenDay: { usedPercent: 32, resetsAt: "2026-10-05T23:00:00.000Z" },
    });
  });

  test("a threshold warning is a reading like any other", () => {
    expect(readPlanLimits(RECORDED_WARNING)).toEqual({
      fiveHour: { usedPercent: 16, resetsAt: "2026-10-01T02:10:00.000Z" },
      sevenDay: { usedPercent: 98, resetsAt: "2026-10-02T17:00:00.000Z" },
    });
  });

  test("keeps a tenth of a percent and drops float noise", () => {
    const reading = readPlanLimits(
      event({
        unifiedWindows: { five_hour: { utilization: 0.29 }, seven_day: { utilization: 0.1234 } },
      }),
    );

    expect(reading?.fiveHour?.usedPercent).toBe(29);
    expect(reading?.sevenDay?.usedPercent).toBe(12.3);
  });

  test("clamps to 0..100 and reads reset times given in milliseconds", () => {
    const reading = readPlanLimits(
      event({
        unifiedWindows: {
          five_hour: { utilization: 1.4, resetsAt: 1_790_909_400_000 },
          seven_day: { utilization: -0.2 },
        },
      }),
    );

    expect(reading).toEqual({
      fiveHour: { usedPercent: 100, resetsAt: "2026-10-02T02:50:00.000Z" },
      sevenDay: { usedPercent: 0, resetsAt: null },
    });
  });

  test("an event without the windows falls back to its own window at the top level", () => {
    const reading = readPlanLimits(
      event({
        status: "allowed",
        rateLimitType: "seven_day",
        utilization: 0.5,
        resetsAt: 1790960400,
      }),
    );

    expect(reading).toEqual({
      sevenDay: { usedPercent: 50, resetsAt: "2026-10-02T17:00:00.000Z" },
    });
  });

  test("a refusal uses up its window, keeping its reset time", () => {
    const reading = readPlanLimits(
      event({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1790909400 }),
    );

    expect(reading).toEqual({
      fiveHour: { usedPercent: 100, resetsAt: "2026-10-02T02:50:00.000Z" },
    });
  });

  test.each([
    ["an ordinary line", '{"type":"assistant","message":{"content":[]}}'],
    ["text that only mentions the event", '{"type":"assistant","text":"\\"rate_limit_event\\""}'],
    ["a cut-off line", RECORDED.slice(0, 80)],
    ["an event with no utilization", event({ status: "allowed", resetsAt: 1790909400 })],
    ["an event about another window", event({ rateLimitType: "opus", utilization: 0.5 })],
    ["an empty line", ""],
  ])("%s reads as nothing", (_name, line) => {
    expect(readPlanLimits(line)).toBeNull();
  });
});
