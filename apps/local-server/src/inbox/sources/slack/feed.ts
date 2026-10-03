import type { InboxItem, SlackHealth } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { IncomingMessage } from "../../matcher.ts";
import type { InboxService } from "../../service.ts";
import type { InboxSourceRepository } from "../../source-repository.ts";
import { catchUp } from "./catch-up.ts";
import { type StoredSlackConnection, slackSourceId } from "./connection-store.ts";
import { NO_EVENTS_FIX } from "./connection-test.ts";
import { createSlackDirectory, record, type SlackDirectory, text } from "./directory.ts";
import { type SlackChange, type SlackEventContext, slackChange } from "./events.ts";
import {
  type SocketModeClient,
  type SocketState,
  startSocketMode,
  type WebSocketLike,
} from "./socket.ts";
import { REVOKED_ERRORS, type SlackWebApi, slackError } from "./web-api.ts";

/**
 * One workspace's live feed: a Socket Mode connection whose message events go through the
 * Inbox's rules, plus a catch-up read whenever the host was not listening. Only what the rules
 * keep is stored; every other message is read in memory and dropped.
 *
 * It also watches for the failure the design's first test found: when a reconnect's catch-up
 * finds messages from a time the socket was open but delivered nothing, Slack is not sending
 * events (Socket Mode off), and the feed says so with the fix while catch-up keeps the Inbox
 * filling, late.
 */
export interface SlackFeedStatus {
  health: SlackHealth;
  lastEventAt: string | null;
  problem: string | null;
}

export interface SlackFeed {
  readonly connection: StoredSlackConnection;
  readonly api: SlackWebApi;
  readonly directory: SlackDirectory;
  status: () => SlackFeedStatus;
  /** Hears every message event the socket delivers (the connection test listens here). */
  tap: (listener: (event: Record<string, unknown>) => void) => () => void;
  stop: () => void;
}

export interface SlackFeedDeps {
  connection: StoredSlackConnection;
  api: SlackWebApi;
  inbox: InboxService;
  sources: InboxSourceRepository;
  /** A live message made or reopened an item (catch-up reads never notify). */
  onNewItem?: (item: InboxItem, message: IncomingMessage) => void;
  createSocket?: (url: string) => WebSocketLike;
  schedule?: (run: () => void, ms: number) => () => void;
  now?: () => number;
  catchUpPauseMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The first connection reads back this far, so the Inbox does not open empty. */
const FIRST_READ_MS = DAY_MS;
/** Never further back than this, however long the host was off. */
const CATCH_UP_MAX_MS = 7 * DAY_MS;
/** A socket that came back this fast missed nothing worth a full read. */
const QUICK_RECONNECT_MS = 5_000;

const logger = getLogger("inbox", "slack-feed");

export const startSlackFeed = (deps: SlackFeedDeps): SlackFeed => {
  const runner = new FeedRunner(deps);
  runner.start();
  return {
    connection: deps.connection,
    api: deps.api,
    directory: runner.directory,
    status: () => runner.status(),
    tap: (listener) => runner.tap(listener),
    stop: () => runner.stop(),
  };
};

/** A socket that was open: since when, until when, and how many events came through it. */
interface OpenWindow {
  since: number;
  events: number;
}

type ClosedWindow = OpenWindow & { until: number };

class FeedRunner {
  readonly directory: SlackDirectory;
  private readonly sourceId: string;
  private readonly context: SlackEventContext;
  private readonly now: () => number;
  private readonly taps = new Set<(event: Record<string, unknown>) => void>();
  private readonly state: SlackFeedStatus = {
    health: "connecting",
    lastEventAt: null,
    problem: null,
  };
  private stopped = false;
  private queue: Promise<void> = Promise.resolve();
  private catchingUp = false;
  /** A catch-up asked for while one ran, to run once it ends. */
  private nextCatchUp: { previous: ClosedWindow | null } | null = null;
  private openWindow: OpenWindow | null = null;
  private offlineSince: number | null = null;
  private connectedOnce = false;
  private socket: SocketModeClient | null = null;

  constructor(private readonly deps: SlackFeedDeps) {
    const { connection, api } = deps;
    this.now = deps.now ?? Date.now;
    this.sourceId = slackSourceId(connection.teamId);
    this.directory = createSlackDirectory({
      api,
      token: connection.userToken,
      me: connection.userId,
    });
    this.context = {
      sourceId: this.sourceId,
      me: connection.userId,
      teamUrl: connection.teamUrl,
      directory: this.directory,
    };
  }

  start(): void {
    const { api, connection } = this.deps;
    this.socket = startSocketMode({
      openUrl: async () => {
        const reply = await api.call("apps.connections.open", connection.appToken);
        const error = slackError(reply);
        return error ? { error } : { url: text(reply.body.url) };
      },
      onEvent: (payload) => this.onEvent(payload),
      onState: (socketState, detail) => this.onState(socketState, detail),
      onFatal: (error) => this.revoked(error),
      isFatal: (error) => REVOKED_ERRORS.has(error),
      createSocket: this.deps.createSocket,
      schedule: this.deps.schedule,
    });
  }

  status(): SlackFeedStatus {
    return { ...this.state };
  }

  tap(listener: (event: Record<string, unknown>) => void): () => void {
    this.taps.add(listener);
    return () => this.taps.delete(listener);
  }

  stop(): void {
    this.stopped = true;
    this.socket?.stop();
  }

  private onEvent(payload: unknown): void {
    const event = record(record(payload).event);
    if (event.type !== "message") return;
    for (const listener of this.taps) listener(event);
    if (this.openWindow) this.openWindow.events += 1;
    this.state.lastEventAt = new Date(this.now()).toISOString();
    this.healthy();
    void this.enqueue(async () => {
      const change = await slackChange(event, this.context);
      if (change) await this.apply(change, true);
    });
  }

  private onState(socketState: SocketState, detail?: string): void {
    if (socketState === "connected") this.connected();
    else if (socketState === "offline") this.offline(detail);
  }

  private connected(): void {
    const at = this.now();
    const previous = this.openWindow ? { ...this.openWindow, until: at } : null;
    const gap = this.offlineSince === null ? 0 : at - this.offlineSince;
    this.openWindow = { since: at, events: 0 };
    this.offlineSince = null;
    if (this.state.health !== "no-events") this.healthy();
    // The first connection, a real gap, or a quiet socket that may not be getting events.
    const needed = !this.connectedOnce || gap > QUICK_RECONNECT_MS || previous?.events === 0;
    this.connectedOnce = true;
    if (needed) void this.runCatchUp(previous);
  }

  private offline(detail: string | undefined): void {
    this.offlineSince ??= this.now();
    if (this.state.health === "revoked") return;
    this.state.health = "offline";
    this.state.problem = `Reconnecting to Slack${detail ? ` (${detail})` : ""}`;
  }

  private healthy(): void {
    this.state.health = "live";
    this.state.problem = null;
  }

  private revoked(error: string): void {
    this.state.health = "revoked";
    this.state.problem = `Slack refused the app-level token (${error}). Paste new tokens in AOP settings › Connections › Slack.`;
  }

  private async apply(change: SlackChange, live: boolean): Promise<void> {
    const { inbox } = this.deps;
    if (change.kind === "edit") {
      await inbox.edit(this.sourceId, change.conversationId, change.messageId, change.text);
      return;
    }
    if (change.kind === "delete") {
      await inbox.remove(this.sourceId, change.conversationId, change.messageId);
      return;
    }
    const item = await inbox.ingest(change.message);
    await this.deps.sources.noteSeen(this.sourceId, change.message.messageId);
    if (item && live && !change.message.fromMe) this.deps.onNewItem?.(item, change.message);
  }

  // One message at a time, in the order Slack sent them: a reply must find its thread noted.
  private enqueue(work: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(work).catch((error: unknown) => {
      logger.warn("A Slack message could not be filed: {error}", { error: String(error) });
    });
    return this.queue;
  }

  private async runCatchUp(previous: ClosedWindow | null): Promise<void> {
    if (this.stopped) return;
    if (this.catchingUp) {
      this.catchUpAfter(previous);
      return;
    }
    this.catchingUp = true;
    // A socket that delivered nothing is checked from its start, even what an earlier read saw.
    // Slack's `oldest` is exclusive, so the read starts a millisecond early: a message sent in the
    // millisecond the socket opened counts as sent while it was open.
    const quiet = previous && previous.events === 0 ? previous : null;
    try {
      const timestamps = await this.readMissed(quiet ? toTs(quiet.since - 1) : null);
      if (quiet && missedWhileOpen(timestamps, quiet)) {
        this.state.health = "no-events";
        this.state.problem = NO_EVENTS_FIX;
      }
    } catch (error) {
      logger.warn("Slack catch-up stopped: {error}", { error: String(error) });
    } finally {
      this.catchingUp = false;
      const next = this.nextCatchUp;
      this.nextCatchUp = null;
      if (next) void this.runCatchUp(next.previous);
    }
  }

  // The running read may be past the conversations this gap touched, and it does not check this
  // socket: read again after it. A quiet socket waiting its turn is not displaced.
  private catchUpAfter(previous: ClosedWindow | null): void {
    if (this.nextCatchUp?.previous?.events !== 0) this.nextCatchUp = { previous };
  }

  private async readMissed(from: string | null): Promise<string[]> {
    const { inbox, connection } = this.deps;
    const start = await this.catchUpStart();
    const since = from !== null && from < start ? from : start;
    const report = await catchUp(since, {
      api: this.deps.api,
      token: connection.userToken,
      directory: this.directory,
      handle: (channel, message) =>
        this.enqueue(async () => {
          const change = await slackChange({ type: "message", channel, ...message }, this.context);
          if (change) await this.apply(change, false);
        }),
      isKnownThread: (channel, ts) => inbox.isKnownThread(this.sourceId, channel, ts),
      knownThreads: () => inbox.activeThreads(this.sourceId, toIso(since)),
      stopped: () => this.stopped,
      pauseMs: this.deps.catchUpPauseMs,
    });
    return report.timestamps;
  }

  private async catchUpStart(): Promise<string> {
    const floor = toTs(this.now() - CATCH_UP_MAX_MS);
    const seen = await this.deps.sources.lastSeen(this.sourceId);
    if (seen) return seen > floor ? seen : floor;
    return toTs(this.now() - FIRST_READ_MS);
  }
}

/** Whether a message was sent while the socket was open, after Slack had time to deliver it. */
const missedWhileOpen = (timestamps: string[], open: { since: number; until: number }): boolean =>
  timestamps.some((ts) => {
    const at = Number(ts) * 1000;
    return at >= open.since && at <= open.until - QUICK_RECONNECT_MS;
  });

const toTs = (ms: number): string => (ms / 1000).toFixed(6);
const toIso = (ts: string): string => new Date(Number(ts) * 1000).toISOString();
