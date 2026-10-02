import { afterEach } from "bun:test";
import type { RoutineInput } from "@aop/common";
import { RoutineInputSchema } from "@aop/common";
import { createCommandContext } from "../context.ts";
import { createProjectServices } from "../project/services.ts";
import {
  createProjectStack,
  type ProjectStack,
  projectSettings,
  useTempAopHome,
} from "../project/test-utils.ts";
import type { RoutineDeps } from "./create.ts";

/** A clock a test moves by hand; every routine reads the time from it. */
export interface TestClock {
  now: () => Date;
  timeZone: () => string;
  set: (iso: string) => void;
  advance: (ms: number) => void;
}

export const createTestClock = (start: string, timeZone = "UTC"): TestClock => {
  let current = Date.parse(start);
  return {
    now: () => new Date(current),
    timeZone: () => timeZone,
    set: (iso) => {
      current = Date.parse(iso);
    },
    advance: (ms) => {
      current += ms;
    },
  };
};

export interface RoutineWorldOptions {
  start?: string;
  timeZone?: string;
  /** When a usage limit holds runs back; null (the default) means none does. */
  limitUntil?: () => string | null;
  settings?: Parameters<typeof projectSettings>[0];
  repos?: number;
  mcp?: boolean;
}

/**
 * A project on the fake CLI with routines on a hand-moved clock in UTC. The scheduler is never
 * started: tests call `processDue` themselves, which is exactly what each timer tick does.
 */
export const useRoutineWorld = () => {
  const home = useTempAopHome();
  let stack: ProjectStack | undefined;

  afterEach(async () => {
    await stack?.cleanup();
    stack = undefined;
  });

  const setup = async (options: RoutineWorldOptions = {}) => {
    const clock = createTestClock(options.start ?? "2026-06-01T08:00:00.000Z", options.timeZone);
    const deps: RoutineDeps = {
      clock,
      usageLimit: async () => options.limitUntil?.() ?? null,
    };
    const s = await createProjectStack(home.path(), {
      repos: options.repos,
      mcp: options.mcp,
      routines: deps,
    });
    stack = s;
    const created = await s.services.projects.create(
      projectSettings({ repoIds: s.repos.map((repo) => repo.id), ...options.settings }),
    );
    if (!created.success) throw new Error("project not created");
    const project = created.project;

    /** A second host process on the same database: its own services, scheduler and runner. */
    const secondHost = () => createProjectServices(createCommandContext(s.db), {}, {}, {}, deps);

    const create = async (input: Partial<RoutineInput> = {}) => {
      const made = await s.services.routines.create(
        project.id,
        RoutineInputSchema.parse({
          name: "Morning digest",
          prompt: "Summarize new issues",
          schedule: { kind: "daily", time: "09:00" },
          ...input,
        }),
        "person",
      );
      if (!made.success) throw new Error(`routine not created: ${JSON.stringify(made.error)}`);
      return made.routine;
    };

    const runs = async (routineId: string) => {
      const listed = await s.services.routines.runs(project.id, routineId);
      if (!listed.success) throw new Error("runs not listed");
      return listed.runs;
    };

    const routine = async (routineId: string) => {
      const found = await s.services.routines.get(project.id, routineId);
      if (!found.success) throw new Error("routine not found");
      return found.routine;
    };

    const threadCount = async () => (await s.ctx.threadRepository.listByProject(project.id)).length;

    return { s, project, clock, create, runs, routine, threadCount, secondHost };
  };

  return { setup };
};

/** One scheduler pass of the stack's own host: what each timer tick does. */
export const processDue = (s: ProjectStack) => s.services.routineScheduler.runPass();
