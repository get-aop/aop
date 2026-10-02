import { mock } from "bun:test";
import type { PlanUsage } from "@aop/common";

export const makePlanUsage = (
  fiveHour: number | null,
  sevenDay: number | null,
  now: number = Date.now(),
): PlanUsage => ({
  fiveHour:
    fiveHour === null
      ? null
      : {
          usedPercent: fiveHour,
          resetsAt: new Date(now + 2 * 3_600_000 + 14 * 60_000).toISOString(),
        },
  sevenDay:
    sevenDay === null
      ? null
      : { usedPercent: sevenDay, resetsAt: new Date(now + 27 * 3_600_000).toISOString() },
  updatedAt: new Date(now - 3 * 60_000).toISOString(),
});

export interface FakePlanHost {
  /** What `GET /api/usage/plan` answers; an Error makes the host fail the request. */
  usage: PlanUsage | null | Error;
  calls: number;
}

/** Answers the dashboard's `GET /api/usage/plan` from `host`, counting the calls. */
export const installFakePlanHost = (initial: Partial<FakePlanHost> = {}): FakePlanHost => {
  const host: FakePlanHost = { usage: null, calls: 0, ...initial };
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    if (!String(input).endsWith("/api/usage/plan")) return Response.json({});
    host.calls += 1;
    return host.usage instanceof Error
      ? Response.json({ error: host.usage.message }, { status: 500 })
      : Response.json({ usage: host.usage });
  }) as unknown as typeof fetch;
  return host;
};
