import { afterEach, describe, expect, test } from "bun:test";
import { INBOX_DEFAULT_RULES } from "@aop/common";
import { itemKey } from "./service.ts";
import { createTestInbox, incomingMessage, SOURCE } from "./test-utils.ts";

type TestInbox = ReturnType<typeof createTestInbox>;
let current: TestInbox | null = null;
const setup = (options: Parameters<typeof createTestInbox>[0] = {}) => {
  current = createTestInbox(options);
  return current;
};

afterEach(async () => {
  await current?.close();
  current = null;
});

const dm = { id: "D1", name: "Jonas Lind", kind: "dm" as const };

describe("ingest", () => {
  test("keeps a mention as an unread item and counts it", async () => {
    const { inbox } = setup();
    const item = await inbox.ingest(incomingMessage({ mentionsMe: true }));

    expect(item).toMatchObject({
      sourceId: SOURCE,
      conversation: { id: "C1", name: "infra", kind: "channel" },
      author: { name: "Priya Rao" },
      text: "the deploy check is flaky",
      reason: "mention",
      state: "unread",
      messageCount: 1,
      permalink: "https://acme.slack.com/archives/C1/p1700000000000100",
      links: [],
    });
    expect(await inbox.summary()).toEqual({ unread: 1 });
  });

  test("stores nothing for a message that does not need the person", async () => {
    const { inbox } = setup();
    expect(await inbox.ingest(incomingMessage())).toBeNull();
    const muted = setup({ rules: { ...INBOX_DEFAULT_RULES, channels: { C1: { mode: "muted" } } } });
    expect(await muted.inbox.ingest(incomingMessage({ mentionsMe: true }))).toBeNull();
    const list = await muted.inbox.list("needs-me", {});
    expect(list.success && list.page.items).toEqual([]);
  });

  test("gathers a DM conversation into one item showing the latest message", async () => {
    const { inbox } = setup();
    await inbox.ingest(incomingMessage({ conversation: dm, messageId: "1.1", text: "hi" }));
    const item = await inbox.ingest(
      incomingMessage({
        conversation: dm,
        messageId: "1.2",
        text: "are we on at 3?",
        sentAt: "2026-10-01T10:05:00.000Z",
      }),
    );

    expect(item).toMatchObject({ reason: "dm", messageCount: 2, text: "are we on at 3?" });
    expect(await inbox.summary()).toEqual({ unread: 1 });
  });

  test("replies to a message that mentioned the person join its item and keep the stronger reason", async () => {
    const { inbox } = setup();
    const first = await inbox.ingest(incomingMessage({ messageId: "5.0", mentionsMe: true }));
    const reply = await inbox.ingest(
      incomingMessage({
        messageId: "5.1",
        threadId: "5.0",
        text: "logs are in the thread",
        author: { id: "U3", name: "Dev Patel", avatarUrl: null },
        sentAt: "2026-10-01T10:10:00.000Z",
      }),
    );

    expect(reply?.id).toBe(first?.id);
    expect(reply).toMatchObject({ reason: "mention", messageCount: 2, threadId: "5.0" });
    expect(reply?.author.name).toBe("Dev Patel");
  });

  test("a reply in a thread the person started needs them; one in a stranger's thread does not", async () => {
    const { inbox } = setup();
    expect(await inbox.ingest(incomingMessage({ messageId: "7.0", fromMe: true }))).toBeNull();

    const mine = await inbox.ingest(incomingMessage({ messageId: "7.1", threadId: "7.0" }));
    const theirs = await inbox.ingest(incomingMessage({ messageId: "8.1", threadId: "8.0" }));

    expect(mine?.reason).toBe("thread-reply");
    expect(theirs).toBeNull();
  });

  test("the person's own answer marks the item read", async () => {
    const { inbox } = setup();
    const item = await inbox.ingest(incomingMessage({ conversation: dm, messageId: "1.1" }));
    await inbox.ingest(
      incomingMessage({
        conversation: dm,
        messageId: "1.2",
        fromMe: true,
        sentAt: "2026-10-01T10:01:00.000Z",
      }),
    );

    const read = await inbox.get(item?.id ?? "");
    expect(read.success && read.item.state).toBe("read");
    expect(await inbox.summary()).toEqual({ unread: 0 });
  });

  test("a redelivered or older message changes nothing", async () => {
    const { inbox } = setup();
    await inbox.ingest(
      incomingMessage({
        conversation: dm,
        messageId: "1.2",
        text: "new",
        sentAt: "2026-10-01T10:05:00.000Z",
      }),
    );
    await inbox.ingest(incomingMessage({ conversation: dm, messageId: "1.2", text: "new" }));
    const item = await inbox.ingest(
      incomingMessage({
        conversation: dm,
        messageId: "1.1",
        text: "old",
        sentAt: "2026-10-01T09:00:00.000Z",
      }),
    );

    expect(item).toMatchObject({ messageCount: 1, text: "new" });
  });

  test("a done item comes back unread when a new message arrives", async () => {
    const { inbox } = setup();
    const item = await inbox.ingest(incomingMessage({ conversation: dm, messageId: "1.1" }));
    await inbox.setState(item?.id ?? "", { state: "done" });
    const back = await inbox.ingest(
      incomingMessage({ conversation: dm, messageId: "1.2", sentAt: "2026-10-01T11:00:00.000Z" }),
    );

    expect(back).toMatchObject({ id: item?.id, state: "unread" });
  });
});

describe("edit and remove", () => {
  test("follow the message the item shows", async () => {
    const { inbox } = setup();
    const item = await inbox.ingest(incomingMessage({ mentionsMe: true }));
    await inbox.edit(SOURCE, "C1", "1700000000.000100", "edited text");
    const edited = await inbox.get(item?.id ?? "");
    expect(edited.success && edited.item.text).toBe("edited text");

    await inbox.remove(SOURCE, "C1", "1700000000.000100");
    await inbox.edit(SOURCE, "C1", "1700000000.000100", "too late");
    const removed = await inbox.get(item?.id ?? "");
    expect(removed.success && removed.item).toMatchObject({ deleted: true, text: "" });
  });
});

describe("list", () => {
  const seed = async (inbox: TestInbox["inbox"]) => {
    const mention = await inbox.ingest(
      incomingMessage({ messageId: "1.0", mentionsMe: true, sentAt: "2026-10-01T10:00:00.000Z" }),
    );
    const direct = await inbox.ingest(
      incomingMessage({ conversation: dm, messageId: "2.0", sentAt: "2026-10-01T10:01:00.000Z" }),
    );
    const here = await inbox.ingest(
      incomingMessage({ messageId: "3.0", broadcast: true, sentAt: "2026-10-01T10:02:00.000Z" }),
    );
    if (!mention || !direct || !here) throw new Error("a seeded message was not kept");
    return { mention: mention.id, direct: direct.id, here: here.id };
  };

  test("each view shows its own items, newest first", async () => {
    const { inbox } = setup();
    const { mention, direct, here } = await seed(inbox);
    await inbox.setState(here, { state: "done" });

    const ids = async (view: Parameters<typeof inbox.list>[0]) => {
      const result = await inbox.list(view, {});
      return result.success ? result.page.items.map((item) => item.id) : [];
    };
    expect(await ids("needs-me")).toEqual([direct, mention]);
    expect(await ids("mentions")).toEqual([mention]);
    expect(await ids("dms")).toEqual([direct]);
    expect(await ids("done")).toEqual([here]);
  });

  test("pages with a cursor and refuses one it did not make", async () => {
    const { inbox } = setup();
    const { mention, direct, here } = await seed(inbox);

    const first = await inbox.list("needs-me", { limit: 2 });
    expect(first.success && first.page.items.map((item) => item.id)).toEqual([here, direct]);
    const cursor = first.success ? (first.page.nextCursor ?? "") : "";
    const second = await inbox.list("needs-me", { limit: 2, cursor });
    expect(second.success && second.page).toEqual({
      items: [expect.objectContaining({ id: mention })],
      nextCursor: null,
    });
    expect(await inbox.list("needs-me", { cursor: "nope" })).toEqual({
      success: false,
      error: { code: "INVALID_INPUT", message: "Unknown cursor" },
    });
  });

  test("a snoozed item leaves the list and comes back unread when its time comes", async () => {
    const { inbox, clock } = setup();
    const item = await inbox.ingest(incomingMessage({ mentionsMe: true }));
    const snoozed = await inbox.setState(item?.id ?? "", {
      state: "snoozed",
      until: "2026-10-01T14:00:00+00:00",
    });
    expect(snoozed.success && snoozed.item).toMatchObject({
      state: "snoozed",
      snoozedUntil: "2026-10-01T14:00:00.000Z",
    });
    expect(await inbox.summary()).toEqual({ unread: 0 });
    const hidden = await inbox.list("needs-me", {});
    expect(hidden.success && hidden.page.items).toEqual([]);

    clock.now = new Date("2026-10-01T14:00:00.000Z");
    const back = await inbox.list("needs-me", {});
    expect(back.success && back.page.items[0]).toMatchObject({
      state: "unread",
      snoozedUntil: null,
    });
    expect(await inbox.summary()).toEqual({ unread: 1 });
  });
});

describe("links", () => {
  test("adds a link once and removes it", async () => {
    const { inbox } = setup();
    const item = await inbox.ingest(incomingMessage({ mentionsMe: true }));
    const id = item?.id ?? "";
    const link = {
      kind: "issue" as const,
      ref: "jira:OPS-1184",
      projectId: "proj_1",
      title: "Deploy check flaky",
    };
    await inbox.addLink(id, link);
    const twice = await inbox.addLink(id, link);
    const links = twice.success ? twice.item.links : [];
    expect(links).toEqual([
      expect.objectContaining({
        kind: "issue",
        ref: "jira:OPS-1184",
        projectId: "proj_1",
        url: null,
      }),
    ]);

    const removed = await inbox.removeLink(id, links[0]?.id ?? "");
    expect(removed.success && removed.item.links).toEqual([]);
    expect(await inbox.removeLink(id, "inlk_missing")).toEqual({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });

  test("an unknown item is not found", async () => {
    const { inbox } = setup();
    expect(await inbox.get("inbx_missing")).toEqual({
      success: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await inbox.setState("inbx_missing", { state: "done" })).toEqual({
      success: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await inbox.addLink("inbx_missing", { kind: "thread", ref: "isess_1" })).toEqual({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("sweep", () => {
  test("removes old items, keeps linked ones without their text, and forgets quiet threads", async () => {
    const { inbox, clock } = setup({ retentionDays: 30 });
    const old = await inbox.ingest(
      incomingMessage({ messageId: "1.0", mentionsMe: true, sentAt: "2026-08-01T10:00:00.000Z" }),
    );
    const linked = await inbox.ingest(
      incomingMessage({ messageId: "2.0", mentionsMe: true, sentAt: "2026-08-02T10:00:00.000Z" }),
    );
    const fresh = await inbox.ingest(
      incomingMessage({ messageId: "3.0", mentionsMe: true, sentAt: "2026-09-30T10:00:00.000Z" }),
    );
    await inbox.addLink(linked?.id ?? "", { kind: "thread", ref: "isess_1" });

    clock.now = new Date("2026-10-01T12:00:00.000Z");
    // The threads were noted when the person was mentioned, on 2026-10-01: none is quiet yet.
    expect(await inbox.sweep()).toEqual({ expired: 1, removed: 1, forgottenThreads: 0 });

    expect((await inbox.get(old?.id ?? "")).success).toBe(false);
    const kept = await inbox.get(linked?.id ?? "");
    expect(kept.success && kept.item).toMatchObject({ expired: true, text: "", permalink: null });
    expect((await inbox.get(fresh?.id ?? "")).success).toBe(true);
    expect(await inbox.sweep()).toEqual({ expired: 0, removed: 0, forgottenThreads: 0 });

    clock.now = new Date("2026-11-15T12:00:00.000Z");
    expect((await inbox.sweep()).forgottenThreads).toBe(3);
  });

  test("keeps everything when retention is 0", async () => {
    const { inbox } = setup({ retentionDays: 0 });
    await inbox.ingest(incomingMessage({ mentionsMe: true, sentAt: "2020-01-01T00:00:00.000Z" }));
    expect(await inbox.sweep()).toEqual({ expired: 0, removed: 0, forgottenThreads: 0 });
  });
});

describe("itemKey", () => {
  test("one per thread, per DM conversation, or per lone channel message", () => {
    expect(itemKey(incomingMessage({ threadId: "5.0" }))).toBe("C1:5.0");
    expect(itemKey(incomingMessage({ conversation: dm }))).toBe("D1");
    expect(itemKey(incomingMessage())).toBe("C1:1700000000.000100");
  });
});
