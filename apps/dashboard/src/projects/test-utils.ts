import type { EventLogEntry, Project, Thread, ThreadStatus } from "@aop/common";
import { buildProject } from "@aop/common/test-utils";
import type { LiveProjects, ProjectStreamEvent } from "./live-projects";
import type { ProjectEntry, ProjectsState } from "./projects-state";

export const AT = "2026-09-29T10:00:00.000Z";

export const makeProject = (overrides: Partial<Project> = {}): Project =>
  buildProject({
    goal: "Keep checkout fast and safe to change",
    repoIds: ["repo_1"],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  });

type ThreadOverrides = Partial<
  Omit<Thread, "status" | "blockedQuestion" | "resolvedAt" | "resumesAt">
> & {
  status?: ThreadStatus;
};

/** A thread in any status: the fields a status requires are filled in, the rest can be overridden. */
export const makeThread = ({ status = "working", ...overrides }: ThreadOverrides = {}): Thread => {
  const base = {
    id: "thr_1",
    projectId: "prj_1",
    title: "Fix 4s cold start regression",
    runtime: { provider: "claude-code" as const, model: "claude-opus-5", effort: "high" as const },
    target: { kind: "host" as const },
    repoId: "repo_1",
    branch: null,
    steps: [],
    liveStatusLine: null,
    artifacts: [],
    repliesCount: 0,
    unread: false,
    lastActivityAt: AT,
    createdAt: AT,
    ...overrides,
  };
  switch (status) {
    case "waiting-on-you":
      return {
        ...base,
        status,
        blockedQuestion: { question: "Which database?", options: [] },
      };
    case "landing":
      return {
        ...base,
        status,
        artifacts: base.artifacts.some((artifact) => artifact.type === "pr")
          ? base.artifacts
          : [{ type: "pr", number: 7, url: "https://github.com/acme/app/pull/7", state: "open" }],
      };
    case "resolved":
      return { ...base, status, resolvedAt: AT };
    case "rate-limited":
      return { ...base, status, resumesAt: "2026-09-29T15:00:00.000Z" };
    default:
      return { ...base, status };
  }
};

export const makeEntry = (
  project: Project,
  threads: Thread[] = [],
  overrides: Partial<ProjectEntry> = {},
): ProjectEntry => ({
  project,
  threads,
  threadsLoaded: true,
  threadsError: null,
  connection: "live",
  ...overrides,
});

export const makeState = (
  entries: ProjectEntry[],
  overrides: Partial<ProjectsState> = {},
): ProjectsState => ({
  phase: "ready",
  error: null,
  reachable: true,
  byId: Object.fromEntries(entries.map((entry) => [entry.project.id, entry])),
  ...overrides,
});

export const threadEntry = (id: number, thread: Thread): EventLogEntry => ({
  id,
  projectId: thread.projectId,
  type: "thread.upserted",
  payload: { thread },
});

export const projectEntry = (id: number, project: Project): EventLogEntry => ({
  id,
  projectId: project.id,
  type: "project.upserted",
  payload: { project },
});

/** A hand-driven `EventSource` for tests: the test says what the host sent and when the connection broke. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(
    readonly url: string,
    readonly withCredentials: boolean,
  ) {}

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  /** Delivers one SSE frame; `id` becomes the event's `lastEventId`, as for a real source. */
  emit(type: string, data: unknown, id = ""): void {
    const event = { data: JSON.stringify(data), lastEventId: id } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitRaw(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data, lastEventId: "" } as MessageEvent);
    }
  }

  /** The browser is retrying by itself (a dropped socket): the source stays `CONNECTING`. */
  drop(): void {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.();
  }

  /** The browser gave up (an HTTP error): the source is `CLOSED` and only a new one can recover. */
  reject(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

/** Sources created through `deps.createSource`, and timers a test can fire by hand. */
export const createFakeStreamDeps = () => {
  const sources: FakeEventSource[] = [];
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  return {
    sources,
    timers,
    deps: {
      createSource: (url: string, withCredentials: boolean) => {
        const source = new FakeEventSource(url, withCredentials);
        sources.push(source);
        return source as unknown as EventSource;
      },
      schedule: (run: () => void, delayMs: number) => {
        const timer = { run, delayMs, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
    /** Runs the timers that are still pending, in order. */
    fireTimers: () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
    },
  };
};

/**
 * A `LiveProjects` whose state a test sets directly: components render from it, and the calls
 * they make (select, adopt, forget) are recorded instead of reaching a host.
 */
export const stubLiveProjects = (initial: ProjectsState) => {
  let state = initial;
  const listeners = new Set<() => void>();
  const calls = {
    setSelected: [] as (string | null)[],
    adopted: [] as Project[],
    forgotten: [] as string[],
    refetched: [] as string[],
  };
  const eventListeners = new Set<(event: ProjectStreamEvent) => void>();
  const live: LiveProjects = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeEvents: (_projectId, listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    start: () => {},
    stop: () => {},
    setSelected: (projectId) => {
      calls.setSelected.push(projectId);
    },
    refresh: async () => {},
    refetch: async (projectId) => {
      calls.refetched.push(projectId);
    },
    adopt: (project) => {
      calls.adopted.push(project);
    },
    forget: (projectId) => {
      calls.forgotten.push(projectId);
    },
  };
  return {
    live,
    calls,
    /** Delivers one stream event (an entry, live text, a resync) to whoever listens to the project's stream. */
    emit: (event: ProjectStreamEvent) => {
      for (const listener of eventListeners) listener(event);
    },
    /** Replaces the state and tells the components, as a stream entry would. */
    set: (next: ProjectsState) => {
      state = next;
      for (const listener of listeners) listener();
    },
  };
};
