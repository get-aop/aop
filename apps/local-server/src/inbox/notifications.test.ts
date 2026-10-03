import { describe, expect, test } from "bun:test";
import type { InboxItem, InboxNotifyMode, InboxReason } from "@aop/common";
import { createInboxNotifier } from "./notifications.ts";

const item = (reason: InboxReason, id = "inbx_1"): InboxItem => ({
  id,
  sourceId: "slack:T1",
  conversation: { id: "C1", name: "infra", kind: "channel" },
  threadId: null,
  messageId: "1.0",
  author: { id: "U2", name: "Priya Rao", avatarUrl: null },
  text: "x".repeat(300),
  reason,
  messageCount: 1,
  state: "unread",
  snoozedUntil: null,
  permalink: null,
  deleted: false,
  expired: false,
  receivedAt: "2026-10-01T10:00:00.000Z",
  links: [],
});

const notifier = (mode: InboxNotifyMode, away: boolean, doNotDisturb = false) => {
  const clock = { now: 1_000_000 };
  const queue = createInboxNotifier({
    modeFor: async () => mode,
    availability: async () => ({ away, doNotDisturb }),
    now: () => clock.now,
  });
  return { queue, clock };
};

describe("desktop notifications", () => {
  test("off notifies nothing; everything notifies every new item", async () => {
    const off = notifier("off", true);
    await off.queue.consider(item("mention"));
    expect(off.queue.page(0).notifications).toEqual([]);

    const all = notifier("all", false);
    await all.queue.consider(item("broadcast"));
    const [first] = all.queue.page(0).notifications;
    expect(first).toMatchObject({ seq: 1, itemId: "inbx_1", title: "Priya Rao in #infra" });
    expect(first?.body).toHaveLength(180);
  });

  test("only when away: DMs and direct mentions, while Slack shows the person away", async () => {
    const away = notifier("away", true);
    await away.queue.consider(item("broadcast", "a"));
    await away.queue.consider(item("mention", "b"));
    expect(away.queue.page(0).notifications.map((entry) => entry.itemId)).toEqual(["b"]);
    const here = notifier("away", false);
    await here.queue.consider(item("dm"));
    expect(here.queue.page(0).notifications).toEqual([]);
  });

  test("Do Not Disturb silences them, and a client gets only what is new and fresh", async () => {
    const quiet = notifier("all", true, true);
    await quiet.queue.consider(item("dm"));
    expect(quiet.queue.page(0).notifications).toEqual([]);

    const { queue, clock } = notifier("all", true);
    expect(queue.page(null)).toEqual({ cursor: 0, notifications: [] });
    await queue.consider(item("dm", "a"));
    await queue.consider(item("dm", "b"));
    expect(queue.page(1).notifications.map((entry) => entry.itemId)).toEqual(["b"]);
    clock.now += 3 * 60 * 1000;
    expect(queue.page(0)).toEqual({ cursor: 2, notifications: [] });
  });
});
