import { describe, expect, test } from "bun:test";
import type { CurrentStep } from "@aop/common";
import { describeSteerDelivery } from "./steer-delivery.ts";

const STARTED = "2026-10-03T10:00:00.000Z";
const NOW = Date.parse(STARTED) + 192_000;
const step: CurrentStep = {
  tool: {
    type: "tool",
    id: "t1",
    name: "Bash",
    detail: "bun test",
    status: "running",
    startedAt: STARTED,
  },
  others: 0,
};

describe("describeSteerDelivery", () => {
  test("a waiting message names the step it waits on and how long it has run", () => {
    expect(describeSteerDelivery({ state: "waiting", step }, { now: NOW })).toBe(
      'Written into its running turn: it reads the message once its current step ends (Bash `bun test`, running 3m 12s). Steer again with when: "interrupt" to stop that step instead.',
    );
  });

  test("an interrupted step is named as the one stopped", () => {
    expect(describeSteerDelivery({ state: "waiting", step }, { interrupted: true, now: NOW })).toBe(
      "Interrupted the step it was on (Bash `bun test`, running 3m 12s): it reads the message now.",
    );
  });

  test("while the model writes, it waits on what it is writing", () => {
    expect(describeSteerDelivery({ state: "waiting", step: null })).toBe(
      "Written into its running turn: it reads the message after what it is writing now.",
    );
  });

  test("delivered, queued and started each say so", () => {
    expect(describeSteerDelivery({ state: "delivered" })).toBe(
      "It has read the message in its running turn.",
    );
    expect(describeSteerDelivery({ state: "queued" })).toStartWith("Queued:");
    expect(describeSteerDelivery({ state: "started" })).toBe("Started a turn for the message.");
  });
});
