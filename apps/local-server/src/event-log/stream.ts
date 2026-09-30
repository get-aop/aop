import { type EventLogEntry, PROJECT_STREAM_EVENTS } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { SSEStreamingApi } from "hono/streaming";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createSSEStreamHelper, type SSEStreamHelper } from "../events/sse-stream.ts";
import { createProjectRepository } from "../project/repository.ts";
import type { EventPublisher } from "./publisher.ts";
import { createEventLogRepository, type EventLogRepository } from "./repository.ts";
import { createLogFeed } from "./stream-feed.ts";
import { createOutbox } from "./stream-outbox.ts";

const logger = getLogger("event-stream");

/**
 * Under Bun's default idle timeout of 10 seconds, which a proxy written with Bun.serve (the
 * dashboard dev server) applies to a stream that goes quiet.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

export interface ProjectStream {
  /** Writes the stream until the client leaves or the project ends. */
  serve: (stream: SSEStreamingApi) => Promise<void>;
}

export interface ProjectStreamService {
  /**
   * A stream of one project's events, resuming after entry `after`, or from now (with a
   * resync first) when `after` is null. Null when there is nothing to serve: the project
   * does not exist, and the client has no removal left to learn about.
   */
  open: (projectId: string, after: number | null) => Promise<ProjectStream | null>;
}

export interface ProjectStreamDeps {
  db: Kysely<Database>;
  publisher: EventPublisher;
  heartbeatIntervalMs?: number;
}

export const createProjectStreamService = (deps: ProjectStreamDeps): ProjectStreamService => {
  const projects = createProjectRepository(deps.db);
  const log = createEventLogRepository(deps.db);

  return {
    open: async (projectId, after) => {
      if (await projects.getById(projectId)) {
        return {
          serve: (stream) =>
            serveProject({ ...deps, log, projectId, after, out: createSSEStreamHelper(stream) }),
        };
      }
      // A deleted project: a client that has not yet seen it go still needs to be told.
      const removal =
        after === null ? null : await log.findLatest(projectId, "project.removed", after);
      return removal
        ? { serve: (stream) => serveRemoval(removal, createSSEStreamHelper(stream)) }
        : null;
    },
  };
};

const serveRemoval = async (removal: EventLogEntry, out: SSEStreamHelper): Promise<void> => {
  await out.sendEvent(PROJECT_STREAM_EVENTS.entry, removal, removal.id);
};

interface Connection extends ProjectStreamDeps {
  log: EventLogRepository;
  projectId: string;
  after: number | null;
  out: SSEStreamHelper;
}

/**
 * One client's stream. The log is the source of truth: a commit, a reconnect, a restart and
 * a heartbeat all mean "read the log after the cursor", so replaying and delivering live are
 * the same code, and a missed wake-up delays an entry but cannot lose it. Live text is the
 * exception because it is not in the log: it waits in the outbox and goes after the entries.
 */
const serveProject = async (connection: Connection): Promise<void> => {
  const { log, projectId, out, publisher } = connection;
  const feed = createLogFeed(log, projectId, connection.after);
  const outbox = createOutbox(out);
  let started = false;
  let pumping = false;
  let again = false;
  let heartbeatDue = false;

  const sendLog = async () => {
    let more = true;
    while (more && !out.isCleanedUp()) {
      const next = await feed.next();
      for (const item of next.items) await outbox.send(item);
      more = next.more;
    }
  };

  // The first frame is a heartbeat so the client sees the connection open at once.
  const begin = async () => {
    started = true;
    await outbox.heartbeat();
    for (const item of await feed.open()) await outbox.send(item);
  };

  const pass = async () => {
    if (!started) await begin();
    await sendLog();
    await outbox.sendDeltas();
    if (!heartbeatDue) return;
    heartbeatDue = false;
    await outbox.heartbeat();
  };

  // One pass at a time. Whatever arrives during a pass sets `again`, so a slow client makes
  // the next pass bigger instead of queueing more work.
  const pump = async (): Promise<void> => {
    if (pumping) {
      again = true;
      return;
    }
    pumping = true;
    try {
      do {
        again = false;
        await pass();
      } while (again && !out.isCleanedUp());
    } catch (error) {
      // A closed database or a corrupt entry ends this stream, not the server. The client
      // reconnects with its cursor and asks again.
      logger.error("Event stream of project {projectId} stopped: {error}", {
        projectId,
        error: String(error),
      });
      out.runCleanup();
    } finally {
      pumping = false;
    }
  };

  // Subscribed before anything is read, so nothing committed from here on is missed.
  const subscription = publisher.subscribe(projectId, {
    onCommit: () => void pump(),
    onDelta: (delta) => {
      outbox.queueDelta(delta);
      void pump();
    },
  });
  out.registerCleanup(subscription.unsubscribe);
  for (const turn of subscription.runningTurns) outbox.queueDelta(turn);

  const heartbeat = setInterval(() => {
    heartbeatDue = true;
    void pump();
  }, connection.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  out.registerCleanup(() => clearInterval(heartbeat));

  const ended = new Promise<void>((resolve) => out.registerCleanup(resolve));
  void pump();
  await ended;
};
