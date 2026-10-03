import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INBOX_DEFAULT_RULES, type InboxRules } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { openInboxDatabase } from "./database.ts";
import { createHostInbox, type HostInboxDeps } from "./host-inbox.ts";
import type { IncomingMessage } from "./matcher.ts";
import { createInboxService, type InboxService } from "./service.ts";
import { createSlackConnectionStore } from "./sources/slack/connection-store.ts";
import type { FakeSlack } from "./sources/slack/fake-slack.ts";
import type { SlackServiceDeps } from "./sources/slack/service.ts";
import { createSlackWebApi } from "./sources/slack/web-api.ts";

export const SOURCE = "slack:T1";

/** A message from someone else in channel #infra that, as given, needs no one. */
export const incomingMessage = (patch: Partial<IncomingMessage> = {}): IncomingMessage => ({
  sourceId: SOURCE,
  messageId: "1700000000.000100",
  conversation: { id: "C1", name: "infra", kind: "channel" },
  threadId: null,
  author: { id: "U2", name: "Priya Rao", avatarUrl: null },
  fromMe: false,
  text: "the deploy check is flaky",
  mentionsMe: false,
  mentionsMyGroup: false,
  broadcast: false,
  sentAt: "2026-10-01T10:00:00.000Z",
  permalink: "https://acme.slack.com/archives/C1/p1700000000000100",
  ...patch,
});

export type TestInbox = ReturnType<typeof createTestInbox>;

/** An Inbox over its own in-memory database, with a clock the test moves. */
export const createTestInbox = (
  options: { retentionDays?: number; rules?: InboxRules; now?: string } = {},
) => {
  const db = openInboxDatabase(":memory:");
  const clock = { now: new Date(options.now ?? "2026-10-01T12:00:00.000Z") };
  const inbox: InboxService = createInboxService({
    db,
    retentionDays: async () => options.retentionDays ?? 30,
    rulesFor: async () => options.rules ?? INBOX_DEFAULT_RULES,
    now: () => clock.now,
  });
  return { db, inbox, clock, close: () => db.destroy() };
};

/**
 * The host's whole Inbox over an in-memory database, its Slack source pointed at a fake Slack
 * (or nowhere) with tokens and the spike folder in a scratch directory. Threads, the coordinator
 * and issues are stubs a test can replace.
 */
export const createTestHostInbox = (
  ctx: LocalServerContext,
  options: {
    slack?: FakeSlack;
    deps?: Partial<HostInboxDeps>;
    testWaitMs?: number;
    now?: () => number;
    createSocket?: SlackServiceDeps["createSocket"];
  } = {},
) => {
  const db = openInboxDatabase(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "aop-inbox-host-"));
  const host = createHostInbox(ctx, db, {
    threads: { spawn: async () => ({ success: false, error: { code: "PROJECT_NOT_FOUND" } }) },
    projects: {
      sendToCoordinator: async () => ({ success: false, error: { code: "PROJECT_NOT_FOUND" } }),
    },
    issues: {
      detail: async (_projectId, key) => ({
        success: false,
        error: { code: "ISSUE_NOT_FOUND", key },
      }),
    },
    ...options.deps,
    slack: {
      store: createSlackConnectionStore(() => join(dir, "connections")),
      api: createSlackWebApi({ url: options.slack?.apiUrl ?? "http://127.0.0.1:9/api/" }),
      spikeDir: join(dir, "spike"),
      testWaitMs: options.testWaitMs ?? 3_000,
      catchUpPauseMs: 0,
      now: options.now,
      createSocket: options.createSocket,
    },
  });
  return {
    host,
    db,
    dir,
    close: async () => {
      host.slack.stop();
      await db.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

/** Waits for a condition the host reaches in the background (a socket event, a catch-up). */
export const eventually = async <T>(
  read: () => Promise<T> | T,
  done: (value: T) => boolean,
  timeoutMs = 3_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await Bun.sleep(20);
    value = await read();
  }
  return value;
};
