import type { Routine, RoutineRun } from "@aop/common";

export const makeRun = (overrides: Partial<RoutineRun> = {}): RoutineRun => ({
  id: "rrun_1",
  routineId: "rtn_1",
  occurrence: "2026-06-01T09:00:00.000Z",
  trigger: "schedule",
  status: "ok",
  reason: null,
  threadId: "thr_1",
  messageId: null,
  createdAt: "2026-06-01T09:00:00.000Z",
  ...overrides,
});

export const makeRoutine = (overrides: Partial<Routine> = {}): Routine => ({
  id: "rtn_1",
  projectId: "p1",
  name: "Morning digest",
  prompt: "Summarize new issues",
  schedule: { kind: "weekdays", time: "09:00" },
  target: "thread",
  repoId: "repo_1",
  model: null,
  effort: null,
  enabled: true,
  catchUp: "skip",
  nextRunAt: "2026-06-02T09:00:00.000Z",
  lastRun: null,
  createdBy: "person",
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T08:00:00.000Z",
  ...overrides,
});

interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

/**
 * The host's routine routes for project `p1`, over an in-memory list a test sets and reads.
 * `refuse` makes every write answer with that error; `owner` decides what `/auth/me` says.
 */
export const createFakeRoutineHost = () => {
  const host = {
    routines: [] as Routine[],
    runs: [] as RoutineRun[],
    owner: true,
    refuse: null as { status: number; error: string; code: string } | null,
    handle: (call: ApiCall): Response | undefined =>
      readRoute(host, call) ?? (host.refuse ? refusal(host.refuse) : writeRoute(host, call)),
  };
  return host;
};

type FakeRoutineHost = ReturnType<typeof createFakeRoutineHost>;

const ROUTINE_PATH = /^\/projects\/p1\/routines\/([^/]+)(\/run|\/runs)?$/;

const DEVICE = { id: "d1", name: "Phone", createdAt: "2026-06-01T00:00:00.000Z", lastSeenAt: null };

const readRoute = (host: FakeRoutineHost, call: ApiCall): Response | undefined => {
  if (call.path === "/auth/me") {
    return Response.json(host.owner ? { kind: "owner" } : { kind: "device", device: DEVICE });
  }
  if (call.method === "GET" && call.path === "/projects/p1/routines") {
    const limits = { minIntervalMinutes: 15, maxActive: 10 };
    return Response.json({ routines: host.routines, timeZone: "UTC", limits });
  }
  if (call.path === "/projects/p1/routines/preview") {
    return Response.json({
      description: "Weekdays at 09:00",
      nextRuns: ["2026-06-02T09:00:00.000Z"],
      timeZone: "UTC",
      problem: null,
    });
  }
  if (call.method === "GET" && call.path.endsWith("/runs"))
    return Response.json({ runs: host.runs });
  return undefined;
};

const refusal = ({ status, error, code }: { status: number; error: string; code: string }) =>
  Response.json({ error, code }, { status });

const writeRoute = (host: FakeRoutineHost, call: ApiCall): Response | undefined => {
  if (call.method === "POST" && call.path === "/projects/p1/routines") {
    const made = makeRoutine({
      id: `rtn_${host.routines.length + 2}`,
      ...(call.body as Partial<Routine>),
    });
    host.routines = [...host.routines, made];
    return Response.json({ routine: made }, { status: 201 });
  }
  const [, id, rest] = call.path.match(ROUTINE_PATH) ?? [];
  const routine = host.routines.find((known) => known.id === id);
  if (!routine)
    return id ? Response.json({ error: "Routine not found" }, { status: 404 }) : undefined;
  if (rest === "/run") return runNow(host, routine);
  if (call.method === "PATCH")
    return replace(host, { ...routine, ...(call.body as Partial<Routine>) });
  if (call.method === "DELETE") {
    host.routines = host.routines.filter((known) => known.id !== routine.id);
    return new Response(null, { status: 204 });
  }
  return undefined;
};

const runNow = (host: FakeRoutineHost, routine: Routine): Response => {
  const run = makeRun({ id: "rrun_now", trigger: "manual", status: "running", threadId: "thr_9" });
  host.runs = [run, ...host.runs];
  const updated = { ...routine, lastRun: run };
  host.routines = host.routines.map((known) => (known.id === routine.id ? updated : known));
  return Response.json({ routine: updated, run }, { status: 201 });
};

const replace = (host: FakeRoutineHost, updated: Routine): Response => {
  host.routines = host.routines.map((known) => (known.id === updated.id ? updated : known));
  return Response.json({ routine: updated });
};
