import type { MessageDelta } from "@aop/common";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createProjectRepository } from "../project/repository.ts";
import { projectSettings } from "../project/test-utils.ts";
import { createEventPublisher, type EventPublisher } from "./publisher.ts";
import type { NewEventLogEntry } from "./repository.ts";
import { createEventStreamRoutes } from "./routes.ts";
import { openSse, type SseConnection } from "./sse-test-client.ts";

/** The stream routes alone, on a real port, so tests speak HTTP without the rest of the app. */
export const serveEventStream = (
  ctx: LocalServerContext,
  options: { heartbeatIntervalMs?: number } = {},
) => {
  const app = new Hono().route("/api/projects", createEventStreamRoutes(ctx, options));
  const server = Bun.serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  return {
    streamUrl: (projectId: string, query = "") =>
      `http://127.0.0.1:${server.port}/api/projects/${projectId}/stream${query}`,
    stop: () => server.stop(true),
  };
};

export interface StreamHarness {
  db: Kysely<Database>;
  ctx: LocalServerContext;
  publisher: EventPublisher;
  /** Subscriptions that streams opened and have not released. */
  openSubscriptions: () => number;
  streamUrl: (projectId: string, query?: string) => string;
  connect: (
    projectId: string,
    query?: string,
    headers?: Record<string, string>,
  ) => Promise<SseConnection>;
  /** Connects and waits for the opening heartbeat, so the stream is subscribed. */
  connectSettled: (
    projectId: string,
    query?: string,
    headers?: Record<string, string>,
  ) => Promise<SseConnection>;
  /** Serves again with other options, for tests that need quick heartbeats. */
  serve: (options: { heartbeatIntervalMs?: number }) => void;
  dispose: () => Promise<void>;
}

/** A migrated database with projects `p1` and `p2`, and its event stream on a real port. */
export const createStreamHarness = async (): Promise<StreamHarness> => {
  const db = await createTestDb();
  const real = createEventPublisher(db);
  let open = 0;
  const publisher: EventPublisher = {
    ...real,
    subscribe: (projectId, listener) => {
      open++;
      const subscription = real.subscribe(projectId, listener);
      return {
        ...subscription,
        unsubscribe: () => {
          open--;
          subscription.unsubscribe();
        },
      };
    },
  };
  const ctx: LocalServerContext = { ...createCommandContext(db), eventPublisher: publisher };
  await createProjects(db, "p1", "p2");

  let server = serveEventStream(ctx);
  const connections: SseConnection[] = [];
  const connect: StreamHarness["connect"] = async (projectId, query, headers) => {
    const connection = await openSse(server.streamUrl(projectId, query), headers);
    connections.push(connection);
    return connection;
  };

  return {
    db,
    ctx,
    publisher,
    openSubscriptions: () => open,
    streamUrl: (projectId, query) => server.streamUrl(projectId, query),
    connect,
    connectSettled: async (projectId, query, headers) => {
      const connection = await connect(projectId, query, headers);
      await connection.waitForFrames("heartbeat", 1);
      return connection;
    },
    serve: (options) => {
      server.stop();
      server = serveEventStream(ctx, options);
    },
    dispose: async () => {
      for (const connection of connections) connection.close();
      server.stop();
      await db.destroy();
    },
  };
};

export const createProjects = async (db: Kysely<Database>, ...ids: string[]): Promise<void> => {
  for (const id of ids) {
    await createProjectRepository(db).create({ id, ...projectSettings({ name: id }) });
  }
};

// The smallest valid entries: enough to have something to append and tell apart.
export const threadRemoved = (projectId: string, threadId: string): NewEventLogEntry => ({
  projectId,
  type: "thread.removed",
  payload: { threadId },
});

export const projectRemoved = (projectId: string): NewEventLogEntry => ({
  projectId,
  type: "project.removed",
  payload: {},
});

export const assistantReply = (
  projectId: string,
  id: string,
  threadId: string | null = null,
): NewEventLogEntry => ({
  projectId,
  type: "message.created",
  payload: {
    message: {
      id,
      projectId,
      threadId,
      createdAt: "2026-09-30T09:00:00.000Z",
      role: "assistant",
      blocks: [{ type: "text", text: "Done." }],
    },
  },
});

type DeltaOverrides = Partial<Omit<MessageDelta, "ops">>;

/** A delta of turn `m1` in the coordinator chat of `p1`, unless overridden. */
export const liveDelta = (
  ops: MessageDelta["ops"],
  overrides: DeltaOverrides = {},
): MessageDelta => ({
  projectId: "p1",
  threadId: null,
  messageId: "m1",
  ops,
  ...overrides,
});

/** The turn's first paragraph starts with `text`. */
export const started = (text: string, overrides: DeltaOverrides = {}): MessageDelta =>
  liveDelta([{ op: "start", index: 0, part: { type: "text", text } }], overrides);

/** `text` is added to the turn's first paragraph. */
export const appended = (text: string, overrides: DeltaOverrides = {}): MessageDelta =>
  liveDelta([{ op: "append", index: 0, text }], overrides);

/** The turn so far is one paragraph, `text`: the baseline a client that connects mid-turn gets. */
export const baseline = (text: string, overrides: DeltaOverrides = {}): MessageDelta =>
  liveDelta([{ op: "reset", parts: [{ type: "text", text }] }], overrides);
