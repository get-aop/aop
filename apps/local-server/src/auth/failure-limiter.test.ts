import { describe, expect, test } from "bun:test";
import { createFailureLimiter } from "./failure-limiter.ts";

const T0 = new Date("2026-09-30T09:00:00.000Z");

const setup = () => {
  let clock = T0;
  const limiter = createFailureLimiter({ maxFailures: 3, windowMs: 60_000, now: () => clock });
  return {
    limiter,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
};

describe("failure limiter", () => {
  test("stays open below the cap", () => {
    const { limiter } = setup();

    limiter.recordFailure();
    limiter.recordFailure();

    expect(limiter.retryAfterMs()).toBe(0);
  });

  test("closes at the cap until the oldest failure leaves the window", () => {
    const { limiter, advance } = setup();
    limiter.recordFailure();
    advance(10_000);
    limiter.recordFailure();
    limiter.recordFailure();

    expect(limiter.retryAfterMs()).toBe(50_000);

    advance(49_999);
    expect(limiter.retryAfterMs()).toBe(1);

    advance(1);
    expect(limiter.retryAfterMs()).toBe(0);
  });

  test("reopens fully once every failure has aged out", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.recordFailure();

    advance(60_000);

    expect(limiter.retryAfterMs()).toBe(0);
    limiter.recordFailure();
    expect(limiter.retryAfterMs()).toBe(0);
  });
});
