import type { EventLogEntry, MessageDelta, Project, Resync, Thread } from "@aop/common";
import { ApiError, isUnauthenticated } from "../api/request";
import {
  browserStreamDeps,
  connectProjectStream,
  type StreamDeps,
  type StreamState,
} from "./project-stream";
import {
  applyEntry,
  applySnapshot,
  initialProjectsState,
  type ProjectsState,
  removeProject,
  setConnection,
  setListError,
  setProjectList,
  upsertProject,
} from "./projects-state";
import { nextWatchSet } from "./watch-set";

export interface ProjectsApi {
  listProjects: () => Promise<Project[]>;
  getProject: (projectId: string) => Promise<Project>;
  listThreads: (projectId: string) => Promise<Thread[]>;
}

/** What a project's stream delivers, for parts of the page that need more than the shell keeps. */
export type ProjectStreamEvent =
  | { kind: "entry"; entry: EventLogEntry }
  | { kind: "delta"; delta: MessageDelta }
  | { kind: "resync"; resync: Resync };

export interface LiveProjectsDeps {
  api: ProjectsApi;
  connect?: typeof connectProjectStream;
  stream?: StreamDeps;
  /** Runs `run` after `delayMs`; returns what cancels it. */
  schedule?: (run: () => void, delayMs: number) => () => void;
}

/** How often projects without a stream, and the list itself, are refetched. */
export const POLL_INTERVAL_MS = 30_000;
const SNAPSHOT_RETRY_MS = 3_000;

export interface LiveProjects {
  getState: () => ProjectsState;
  subscribe: (listener: () => void) => () => void;
  /**
   * Hears everything one project's stream delivers, entries and live text included, as it
   * arrives. The chat and the thread pane read messages from here; the shell needs only state.
   */
  subscribeEvents: (projectId: string, listener: (event: ProjectStreamEvent) => void) => () => void;
  start: () => void;
  stop: () => void;
  /** The project the page is showing: it always gets a stream. */
  setSelected: (projectId: string | null) => void;
  refresh: () => Promise<void>;
  /** A project this client just created or changed; the stream repeats it harmlessly. */
  adopt: (project: Project) => void;
  /** A project this client just deleted. */
  forget: (projectId: string) => void;
}

export const createLiveProjects = (deps: LiveProjectsDeps): LiveProjects => {
  const { api } = deps;
  const connect = deps.connect ?? connectProjectStream;
  const streamDeps = deps.stream ?? browserStreamDeps;
  const schedule = deps.schedule ?? browserStreamDeps.schedule;

  let state = initialProjectsState;
  let selectedId: string | null = null;
  let running = false;
  let pollChain = 0;
  let cancelPoll: (() => void) | null = null;
  let watched: string[] = [];
  const streams = new Map<string, { close: () => void }>();
  // Entries that arrive while a snapshot is in flight wait here: the snapshot may have been
  // read before them, and applying it afterwards would roll them back.
  const resyncing = new Map<string, EventLogEntry[]>();
  const retries = new Map<string, () => void>();
  const stateListeners = new Set<() => void>();
  const eventListeners = new Map<string, Set<(event: ProjectStreamEvent) => void>>();

  const setState = (next: ProjectsState) => {
    if (next === state) return;
    const before = watchableIds(state);
    state = next;
    for (const listener of stateListeners) listener();
    // Only a project appearing, disappearing or being archived changes who gets a stream.
    if (watchableIds(state) !== before) reconcile();
  };

  const publish = (projectId: string, event: ProjectStreamEvent) => {
    for (const listener of eventListeners.get(projectId) ?? []) listener(event);
  };

  // Most recently changed first.
  const eligibleIds = (): string[] =>
    Object.values(state.byId)
      .filter(({ project }) => project.status !== "archived")
      .sort((a, b) => Date.parse(b.project.updatedAt) - Date.parse(a.project.updatedAt))
      .map(({ project }) => project.id);

  // Opens and closes streams so exactly the watch set has one.
  const reconcile = () => {
    if (!running) return;
    watched = nextWatchSet(watched, eligibleIds(), selectedId);
    for (const projectId of [...streams.keys()].filter((id) => !watched.includes(id))) {
      closeStream(projectId);
      setState(setConnection(state, projectId, "idle"));
    }
    for (const projectId of watched.filter((id) => !streams.has(id))) openStream(projectId);
  };

  const closeStream = (projectId: string) => {
    streams.get(projectId)?.close();
    streams.delete(projectId);
    resyncing.delete(projectId);
    retries.get(projectId)?.();
    retries.delete(projectId);
  };

  const openStream = (projectId: string) => {
    const onState = (streamState: StreamState) =>
      setState(setConnection(state, projectId, streamState));
    streams.set(
      projectId,
      connect(
        projectId,
        {
          onState,
          onEntry: (entry) => receive(projectId, entry),
          onDelta: (delta) => publish(projectId, { kind: "delta", delta }),
          onResync: (resync) => {
            publish(projectId, { kind: "resync", resync });
            void resyncProject(projectId);
          },
          // A restarting host answers with an error the browser treats as final: the fetch
          // tells a host that is coming back from a project that is gone or a device that is out.
          onRejected: () => void snapshot(projectId),
        },
        streamDeps,
      ),
    );
  };

  const receive = (projectId: string, entry: EventLogEntry) => {
    publish(projectId, { kind: "entry", entry });
    const queue = resyncing.get(projectId);
    if (queue) {
      queue.push(entry);
      return;
    }
    setState(applyEntry(state, entry));
  };

  // Refetches one project, replaces what the page holds, then replays the entries that came
  // in meanwhile. Applying by id makes an entry the snapshot already contained harmless.
  const resyncProject = async (projectId: string) => {
    if (resyncing.has(projectId)) return;
    resyncing.set(projectId, []);
    const fetched = await snapshot(projectId);
    const queued = resyncing.get(projectId) ?? [];
    resyncing.delete(projectId);
    for (const entry of queued) setState(applyEntry(state, entry));
    if (!fetched && streams.has(projectId)) {
      retries.get(projectId)?.();
      retries.set(
        projectId,
        schedule(() => void resyncProject(projectId), SNAPSHOT_RETRY_MS),
      );
    }
  };

  // True when the project's project and threads were fetched and stored.
  const snapshot = async (projectId: string): Promise<boolean> => {
    try {
      const [project, threads] = await Promise.all([
        api.getProject(projectId),
        api.listThreads(projectId),
      ]);
      setState(applySnapshot(state, project, threads));
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) forget(projectId);
      return false;
    }
  };

  const refresh = async () => {
    try {
      setState(setProjectList(state, await api.listProjects()));
    } catch (error) {
      // A device that is not paired is the pairing screen's business, not an error to show.
      if (!isUnauthenticated(error)) setState(setListError(state, describe(error)));
    }
  };

  // Projects without a stream, and the list (a project made on another device), are refetched.
  const poll = async () => {
    await refresh();
    const idle = eligibleIds().filter((projectId) => !streams.has(projectId));
    await Promise.all(idle.map(snapshot));
  };

  // One chain of polls per start: a start that follows a stop at once (React's development
  // remount) must not leave the first chain running beside the second.
  const armPoll = (chain: number) => {
    if (chain !== pollChain) return;
    cancelPoll = schedule(() => {
      void poll().finally(() => armPoll(chain));
    }, POLL_INTERVAL_MS);
  };

  const forget = (projectId: string) => {
    closeStream(projectId);
    watched = watched.filter((id) => id !== projectId);
    setState(removeProject(state, projectId));
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeEvents: (projectId, listener) => {
      const listeners = eventListeners.get(projectId) ?? new Set();
      listeners.add(listener);
      eventListeners.set(projectId, listeners);
      return () => listeners.delete(listener);
    },
    start: () => {
      if (running) return;
      running = true;
      const chain = ++pollChain;
      reconcile();
      void poll().then(() => armPoll(chain));
    },
    stop: () => {
      running = false;
      pollChain += 1;
      cancelPoll?.();
      for (const stream of streams.values()) stream.close();
      for (const cancel of retries.values()) cancel();
      streams.clear();
      retries.clear();
      resyncing.clear();
      watched = [];
    },
    setSelected: (projectId) => {
      selectedId = projectId;
      reconcile();
    },
    refresh,
    adopt: (project) => setState(upsertProject(state, project)),
    forget,
  };
};

const watchableIds = (state: ProjectsState): string =>
  Object.values(state.byId)
    .filter(({ project }) => project.status !== "archived")
    .map(({ project }) => project.id)
    .sort()
    .join("|");

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : "Could not reach the host";
