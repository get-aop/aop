import { afterEach, describe, expect, test } from "bun:test";
import { armResumeTimer, cancelAllResumeTimers, cancelResumeTimer } from "./resume-timers.ts";

const inMs = (ms: number): string => new Date(Date.now() + ms).toISOString();

/** A timer callback that records when, and under what name, it ran. */
const recorder = () => {
  const fired: string[] = [];
  const at: number[] = [];
  const started = Date.now();
  return {
    fired,
    at,
    call: (name: string) => async () => {
      fired.push(name);
      at.push(Date.now() - started);
    },
  };
};

describe("resume timers", () => {
  afterEach(cancelAllResumeTimers);

  test("fires once, at the time it was armed for", async () => {
    const run = recorder();

    armResumeTimer("s1", inMs(120), run.call("s1"));
    await Bun.sleep(60);
    expect(run.fired).toEqual([]);
    await Bun.sleep(150);

    expect(run.fired).toEqual(["s1"]);
    expect(run.at[0]).toBeGreaterThanOrEqual(110);
  });

  test("a time already past fires at once", async () => {
    const run = recorder();

    armResumeTimer("s1", inMs(-60_000), run.call("s1"));
    await Bun.sleep(30);

    expect(run.fired).toEqual(["s1"]);
  });

  test("arming a session again replaces its timer: only the last one fires", async () => {
    const run = recorder();

    armResumeTimer("s1", inMs(40), run.call("first"));
    armResumeTimer("s1", inMs(80), run.call("second"));
    await Bun.sleep(160);

    expect(run.fired).toEqual(["second"]);
  });

  test("timers of different sessions are independent, and cancelling one leaves the others", async () => {
    const run = recorder();

    armResumeTimer("a", inMs(40), run.call("a"));
    armResumeTimer("b", inMs(40), run.call("b"));
    cancelResumeTimer("a");
    await Bun.sleep(120);

    expect(run.fired).toEqual(["b"]);
  });

  test("cancelling all leaves nothing to fire", async () => {
    const run = recorder();
    armResumeTimer("a", inMs(30), run.call("a"));
    armResumeTimer("b", inMs(30), run.call("b"));

    cancelAllResumeTimers();
    await Bun.sleep(100);

    expect(run.fired).toEqual([]);
  });
});
