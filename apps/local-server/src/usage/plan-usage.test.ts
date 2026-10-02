import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlanUsage, observePlanUsage, resetPlanUsageForTests } from "./plan-usage.ts";

const line = (fiveHour: number | null, sevenDay: number | null) =>
  JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: {
      unifiedWindows: {
        ...(fiveHour === null
          ? {}
          : { five_hour: { utilization: fiveHour, resetsAt: 1790909400 } }),
        ...(sevenDay === null
          ? {}
          : { seven_day: { utilization: sevenDay, resetsAt: 1791241200 } }),
      },
    },
  });

const AT = new Date("2026-10-01T22:00:00.000Z");
const LATER = new Date("2026-10-01T22:05:00.000Z");

describe("plan usage", () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.AOP_HOME;
    home = mkdtempSync(join(tmpdir(), "aop-plan-usage-"));
    process.env.AOP_HOME = home;
    resetPlanUsageForTests();
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.AOP_HOME;
    else process.env.AOP_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
    resetPlanUsageForTests();
  });

  test("is unknown until a run reports it", async () => {
    await observePlanUsage('{"type":"assistant"}', AT);

    expect(await getPlanUsage()).toBeNull();
    expect(existsSync(join(home, "plan-usage.json"))).toBe(false);
  });

  test("holds the latest reading, stamped with when it was heard", async () => {
    await observePlanUsage(line(0.1, 0.2), AT);
    await observePlanUsage(line(0.43, 0.32), LATER);

    expect(await getPlanUsage()).toEqual({
      fiveHour: { usedPercent: 43, resetsAt: "2026-10-02T02:50:00.000Z" },
      sevenDay: { usedPercent: 32, resetsAt: "2026-10-05T23:00:00.000Z" },
      updatedAt: LATER.toISOString(),
    });
  });

  test("a reading of one window keeps what was known of the other", async () => {
    await observePlanUsage(line(0.1, 0.2), AT);
    await observePlanUsage(line(0.5, null), LATER);

    const usage = await getPlanUsage();
    expect(usage?.fiveHour?.usedPercent).toBe(50);
    expect(usage?.sevenDay?.usedPercent).toBe(20);
  });

  test("a read waits for the readings already heard", async () => {
    void observePlanUsage(line(0.7, 0.8), AT);

    expect((await getPlanUsage())?.fiveHour?.usedPercent).toBe(70);
  });

  test("survives a restart through AOP_HOME", async () => {
    await observePlanUsage(line(0.43, 0.32), AT);
    resetPlanUsageForTests();

    expect((await getPlanUsage())?.sevenDay?.usedPercent).toBe(32);
  });

  test("a reading heard before the stored one is read still merges with it", async () => {
    await observePlanUsage(line(0.1, 0.2), AT);
    resetPlanUsageForTests();
    await observePlanUsage(line(0.6, null), LATER);

    const usage = await getPlanUsage();
    expect(usage?.fiveHour?.usedPercent).toBe(60);
    expect(usage?.sevenDay?.usedPercent).toBe(20);
  });

  test("an unreadable stored file is no usage, not an error", async () => {
    writeFileSync(join(home, "plan-usage.json"), "{not json");

    expect(await getPlanUsage()).toBeNull();
  });
});
