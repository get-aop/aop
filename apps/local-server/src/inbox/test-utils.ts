import { INBOX_DEFAULT_RULES, type InboxRules } from "@aop/common";
import { openInboxDatabase } from "./database.ts";
import type { IncomingMessage } from "./matcher.ts";
import { createInboxService, type InboxService } from "./service.ts";

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
