import {
  type EventLogEntry,
  EventLogEntrySchema,
  PROJECT_STREAM_EVENTS,
  type Project,
  ProjectSchema,
  ResyncSchema,
  readSseBody,
  type SseMessage,
  type Thread,
  ThreadSchema,
} from "@aop/common";
import type { FetchLike } from "../connection/host-client";
import { InboxPoll } from "./inbox-poll";
import { decideNotification, type NotificationIntent } from "./policy";

export interface WatchTarget {
  baseUrl: string;
  /** Null for the host on this Mac, which needs none. */
  token: string | null;
}

export interface WatcherDeps {
  fetch: FetchLike;
  notify: (intent: NotificationIntent) => void;
  isAppFocused: () => boolean;
  now: () => number;
  schedule: (run: () => void, delayMs: number) => () => void;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface ProjectWatcher {
  /** Follows every active project of the host. Replaces whatever it was following. */
  start: (target: WatchTarget) => void;
  stop: () => void;
}

/** Streams the watcher keeps open. The host holds one connection per stream for as long as the app runs. */
export const MAX_WATCHED_PROJECTS = 16;
const REFRESH_INTERVAL_MS = 60_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * Turns a host's project streams, and the Inbox's notification queue, into OS notifications. It runs in the app's main process, not
 * in the dashboard: the dashboard streams only the project on screen, while a notification is
 * about any project, and it must reach the person when the window is closed, hidden, or showing
 * the connect screen. The main process also owns the token, so it reads the streams with
 * `fetch` and a bearer header, with no cookie and no `EventSource`.
 */
export const createProjectWatcher = (deps: WatcherDeps): ProjectWatcher => {
  let session: Session | null = null;

  const stop = (): void => {
    session?.close();
    session = null;
  };

  return {
    start: (target) => {
      stop();
      session = new Session(target, deps);
      session.begin();
    },
    stop,
  };
};

class Session {
  private readonly watches = new Map<string, ProjectWatch>();
  private readonly inbox: InboxPoll;
  private cancelRefresh: (() => void) | null = null;
  private closed = false;

  constructor(
    private readonly target: WatchTarget,
    private readonly deps: WatcherDeps,
  ) {
    this.inbox = new InboxPoll(target, deps, () => this.unauthorized());
  }

  begin(): void {
    void this.refresh();
    this.inbox.start();
  }

  close(): void {
    this.closed = true;
    this.inbox.close();
    this.cancelRefresh?.();
    for (const watch of this.watches.values()) watch.close();
    this.watches.clear();
  }

  /** The host said this device is not known: nothing more can be read until it pairs again. */
  unauthorized(): void {
    this.deps.log?.("watcher stopped: the host rejected this device");
    this.close();
  }

  private async refresh(): Promise<void> {
    const projects = await this.listActiveProjects();
    if (this.closed) return;
    if (projects) this.reconcile(projects);
    this.cancelRefresh = this.deps.schedule(() => void this.refresh(), REFRESH_INTERVAL_MS);
  }

  private async listActiveProjects(): Promise<Project[] | null> {
    try {
      const response = await this.deps.fetch(`${this.target.baseUrl}/api/projects`, {
        headers: authHeaders(this.target),
        cache: "no-store",
        credentials: "omit",
      });
      if (response.status === 401) {
        this.unauthorized();
        return null;
      }
      if (!response.ok) return null;
      const body = (await response.json()) as { projects?: unknown };
      const parsed = ProjectSchema.array().safeParse(body.projects);
      if (!parsed.success) {
        this.deps.log?.("the host's project list is not in a shape this app reads");
        return null;
      }
      return parsed.data.filter((project) => project.status === "active");
    } catch (error) {
      this.deps.log?.("could not list projects", { error: String(error) });
      return null;
    }
  }

  private reconcile(projects: Project[]): void {
    const wanted = new Map(projects.slice(0, MAX_WATCHED_PROJECTS).map((p) => [p.id, p]));
    for (const [id, watch] of this.watches) {
      if (wanted.has(id)) continue;
      watch.close();
      this.watches.delete(id);
    }
    for (const project of wanted.values()) {
      const existing = this.watches.get(project.id);
      if (existing) existing.project = project;
      else this.addWatch(project);
    }
  }

  private addWatch(project: Project): void {
    const watch = new ProjectWatch(project, this.target, this.deps, {
      onUnauthorized: () => this.unauthorized(),
      onGone: () => {
        this.watches.delete(project.id);
      },
    });
    this.watches.set(project.id, watch);
    watch.open();
  }
}

interface WatchEvents {
  onUnauthorized: () => void;
  onGone: () => void;
}

class ProjectWatch {
  private readonly threads = new Map<string, Thread>();
  private cursor: number | null = null;
  private seeded = false;
  private seeding: Promise<void> | null = null;
  private failures = 0;
  private abort = new AbortController();
  private cancelRetry: (() => void) | null = null;
  private closed = false;

  constructor(
    public project: Project,
    private readonly target: WatchTarget,
    private readonly deps: WatcherDeps,
    private readonly events: WatchEvents,
  ) {}

  open(): void {
    void this.connect();
  }

  close(): void {
    this.closed = true;
    this.cancelRetry?.();
    this.abort.abort();
  }

  private async connect(): Promise<void> {
    this.abort = new AbortController();
    try {
      const response = await this.deps.fetch(this.streamUrl(), {
        headers: { ...authHeaders(this.target), Accept: "text/event-stream" },
        cache: "no-store",
        credentials: "omit",
        signal: this.abort.signal,
      });
      if (response.status === 401) return this.events.onUnauthorized();
      if (response.status === 404) return this.gone();
      if (!response.ok || !response.body) throw new Error(`stream answered ${response.status}`);

      this.failures = 0;
      // A reconnect keeps what it knew, so what happened while it was away still reads as a change.
      if (!this.seeded) void this.seed();
      await readSseBody(response.body, (message) => this.handle(message));
    } catch (error) {
      if (!this.closed)
        this.deps.log?.("project stream ended", { project: this.project.id, error: String(error) });
    }
    this.retryLater();
  }

  private streamUrl(): string {
    const after = this.cursor === null ? "" : `?after=${this.cursor}`;
    return `${this.target.baseUrl}/api/projects/${encodeURIComponent(this.project.id)}/stream${after}`;
  }

  private retryLater(): void {
    if (this.closed) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
    this.failures += 1;
    this.cancelRetry = this.deps.schedule(() => void this.connect(), delay);
  }

  private gone(): void {
    this.close();
    this.events.onGone();
  }

  private handle(message: SseMessage): void {
    if (message.event === PROJECT_STREAM_EVENTS.resync) {
      this.handleResync(message.data);
      return;
    }
    if (message.event !== PROJECT_STREAM_EVENTS.entry) return;
    const entry = parseJson(EventLogEntrySchema, message.data);
    if (!entry || (this.cursor !== null && entry.id <= this.cursor)) return;
    this.cursor = entry.id;
    // Until the thread list has arrived, "what changed" has nothing to compare with: wait for it.
    if (this.seeding) void this.seeding.then(() => this.apply(entry));
    else this.apply(entry);
  }

  private handleResync(data: string): void {
    const resync = parseJson(ResyncSchema, data);
    if (!resync) return;
    this.cursor = resync.cursor;
    void this.seed();
  }

  /** Learns the threads the host has now, so later entries are compared with something real. */
  private seed(): Promise<void> {
    if (this.seeding) return this.seeding;
    this.seeding = this.loadThreads().finally(() => {
      this.seeding = null;
    });
    return this.seeding;
  }

  private async loadThreads(): Promise<void> {
    try {
      const response = await this.deps.fetch(
        `${this.target.baseUrl}/api/projects/${encodeURIComponent(this.project.id)}/threads`,
        { headers: authHeaders(this.target), cache: "no-store", credentials: "omit" },
      );
      if (!response.ok) return;
      const body = (await response.json()) as { threads?: unknown };
      const parsed = ThreadSchema.array().safeParse(body.threads);
      if (!parsed.success) return;
      this.threads.clear();
      for (const thread of parsed.data) this.threads.set(thread.id, thread);
      this.seeded = true;
    } catch (error) {
      this.deps.log?.("could not read threads", { project: this.project.id, error: String(error) });
    }
  }

  private apply(entry: EventLogEntry): void {
    if (this.closed) return;
    // Without a baseline every thread looks new, and each would announce itself once.
    if (this.seeded) this.announce(entry);
    this.remember(entry);
  }

  private announce(entry: EventLogEntry): void {
    const intent = decideNotification(entry, {
      project: this.project,
      previousThread:
        entry.type === "thread.upserted" ? this.threads.get(entry.payload.thread.id) : undefined,
      threadTitle: (id) => this.threads.get(id)?.title,
      now: this.deps.now(),
      appFocused: this.deps.isAppFocused(),
    });
    if (intent) this.deps.notify(intent);
  }

  private remember(entry: EventLogEntry): void {
    if (entry.type === "thread.upserted")
      this.threads.set(entry.payload.thread.id, entry.payload.thread);
    else if (entry.type === "thread.removed") this.threads.delete(entry.payload.threadId);
    else if (entry.type === "project.upserted") this.project = entry.payload.project;
    else if (entry.type === "project.removed") this.gone();
  }
}

const authHeaders = (target: WatchTarget): Record<string, string> =>
  target.token === null ? {} : { Authorization: `Bearer ${target.token}` };

const parseJson = <T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  data: string,
): T | null => {
  try {
    const parsed = schema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
