import type { EventLogEntry, Project, Thread } from "@aop/common";

/** The state of one project's event stream, as far as the page can tell. */
export type StreamConnection = "idle" | "connecting" | "live" | "reconnecting";

export interface ProjectEntry {
  project: Project;
  /** Every thread of the project. Meaningful once `threadsLoaded`. */
  threads: readonly Thread[];
  threadsLoaded: boolean;
  /**
   * Why the last fetch of the threads failed, in the host's words; null once one succeeds. It
   * tells a load that is failing from one that is only slow.
   */
  threadsError: string | null;
  connection: StreamConnection;
}

export interface ProjectsState {
  /** `loading` until the first project list arrives; `error` if it could not be fetched. */
  phase: "loading" | "ready" | "error";
  error: string | null;
  /** False while the last fetch of the project list failed: the host is down or out of reach. */
  reachable: boolean;
  byId: Readonly<Record<string, ProjectEntry>>;
}

export const initialProjectsState: ProjectsState = {
  phase: "loading",
  error: null,
  reachable: true,
  byId: {},
};

/**
 * Everything below is a pure step from one state to the next. Entities arrive whole and are
 * applied by id, so replaying an entry, or applying one the state already reflects, changes
 * nothing: a reconnect that repeats an entry cannot corrupt the page.
 */

export const setProjectList = (
  state: ProjectsState,
  projects: readonly Project[],
): ProjectsState => {
  const byId: Record<string, ProjectEntry> = {};
  for (const project of projects) {
    const known = state.byId[project.id];
    byId[project.id] = known
      ? { ...known, project: newerProject(known.project, project) }
      : newEntry(project);
  }
  return { phase: "ready", error: null, reachable: true, byId };
};

/** A failed fetch of the list: the first one is an error to show; later ones only mean "out of reach". */
export const setListError = (state: ProjectsState, error: string): ProjectsState =>
  state.phase === "ready"
    ? { ...state, reachable: false }
    : { ...state, phase: "error", error, reachable: false };

/** A project this client just created or changed itself; the stream will repeat it harmlessly. */
export const upsertProject = (state: ProjectsState, project: Project): ProjectsState => {
  const known = state.byId[project.id];
  const entry: ProjectEntry = known
    ? { ...known, project: newerProject(known.project, project) }
    : newEntry(project);
  return { ...state, phase: "ready", byId: { ...state.byId, [project.id]: entry } };
};

export const removeProject = (state: ProjectsState, projectId: string): ProjectsState => {
  if (!(projectId in state.byId)) return state;
  const { [projectId]: _removed, ...rest } = state.byId;
  return { ...state, byId: rest };
};

/** Replaces what the page knows of one project: a snapshot taken after a resync or a poll. */
export const applySnapshot = (
  state: ProjectsState,
  project: Project,
  threads: readonly Thread[],
): ProjectsState => {
  const known = state.byId[project.id];
  const entry: ProjectEntry = {
    project,
    threads,
    threadsLoaded: true,
    threadsError: null,
    connection: known?.connection ?? "idle",
  };
  // Anything the host answered proves it is reachable, so a fetch that failed while it was down stops counting.
  return { ...state, reachable: true, byId: { ...state.byId, [project.id]: entry } };
};

/** A fetch of one project's threads that failed: the pages say why until one succeeds. */
export const setThreadsError = (
  state: ProjectsState,
  projectId: string,
  error: string,
): ProjectsState => {
  const entry = state.byId[projectId];
  if (!entry || entry.threadsError === error) return state;
  return { ...state, byId: { ...state.byId, [projectId]: { ...entry, threadsError: error } } };
};

export const setConnection = (
  state: ProjectsState,
  projectId: string,
  connection: StreamConnection,
): ProjectsState => {
  const entry = state.byId[projectId];
  if (!entry || entry.connection === connection) return state;
  // A stream that is live is the host answering, whatever the last list fetch said.
  const reachable = connection === "live" || state.reachable;
  return { ...state, reachable, byId: { ...state.byId, [projectId]: { ...entry, connection } } };
};

/** One log entry from a project's stream. Messages belong to the chat and change nothing here. */
export const applyEntry = (state: ProjectsState, entry: EventLogEntry): ProjectsState => {
  switch (entry.type) {
    case "project.upserted":
      return upsertProject(state, entry.payload.project);
    case "project.removed":
      return removeProject(state, entry.projectId);
    case "thread.upserted":
      return upsertThread(state, entry.payload.thread);
    case "thread.removed":
      return removeThread(state, entry.projectId, entry.payload.threadId);
    case "message.created":
    case "message.updated":
      return state;
  }
};

const upsertThread = (state: ProjectsState, thread: Thread): ProjectsState => {
  const entry = state.byId[thread.projectId];
  if (!entry) return state;
  const index = entry.threads.findIndex((known) => known.id === thread.id);
  const threads =
    index === -1
      ? [...entry.threads, thread]
      : entry.threads.map((known, at) => (at === index ? thread : known));
  return { ...state, byId: { ...state.byId, [thread.projectId]: { ...entry, threads } } };
};

const removeThread = (state: ProjectsState, projectId: string, threadId: string): ProjectsState => {
  const entry = state.byId[projectId];
  if (!entry?.threads.some((thread) => thread.id === threadId)) return state;
  const threads = entry.threads.filter((thread) => thread.id !== threadId);
  return { ...state, byId: { ...state.byId, [projectId]: { ...entry, threads } } };
};

const newEntry = (project: Project): ProjectEntry => ({
  project,
  threads: [],
  threadsLoaded: false,
  threadsError: null,
  connection: "idle",
});

// A list fetched a moment ago must not roll back a project a stream entry has since updated.
const newerProject = (known: Project, incoming: Project): Project =>
  Date.parse(incoming.updatedAt) >= Date.parse(known.updatedAt) ? incoming : known;
