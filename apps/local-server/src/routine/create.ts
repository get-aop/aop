import { systemTimeZone } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { ChatEngine } from "../project/engine.ts";
import type { RoutineLaunchServices } from "./launch.ts";
import { createRoutineRepository } from "./repository.ts";
import { createRoutineRunner, type RoutineClock } from "./runner.ts";
import { createRoutineScheduler, type RoutineScheduler, type TimerApi } from "./scheduler.ts";
import { createRoutineService, type RoutineService } from "./service.ts";
import { createUsageLimitCheck, type UsageLimitCheck } from "./usage-limit.ts";

/** Seams for tests: the clock and zone, timers, and what the Claude plan's limit reads. */
export interface RoutineDeps {
  clock?: Partial<RoutineClock>;
  timers?: TimerApi;
  usageLimit?: UsageLimitCheck;
}

export interface Routines {
  service: RoutineService;
  /** The server starts it (see server.ts); nothing fires until it does. */
  scheduler: RoutineScheduler;
}

/** The routine domain over the services its runs call. */
export const createRoutines = (
  ctx: LocalServerContext,
  services: RoutineLaunchServices & { chat: ChatEngine },
  deps: RoutineDeps = {},
): Routines => {
  const clock: RoutineClock = {
    now: deps.clock?.now ?? (() => new Date()),
    timeZone: deps.clock?.timeZone ?? systemTimeZone,
  };
  const runner = createRoutineRunner(
    ctx,
    services,
    clock,
    deps.usageLimit ?? createUsageLimitCheck(ctx.db),
  );
  const scheduler = createRoutineScheduler(
    runner,
    createRoutineRepository(ctx.db),
    clock,
    deps.timers,
  );
  return {
    service: createRoutineService(ctx, runner, services.chat, clock, scheduler.poke),
    scheduler,
  };
};
