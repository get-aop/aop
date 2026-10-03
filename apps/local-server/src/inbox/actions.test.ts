import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { INBOX_DEFAULT_RULES, type InboxItem } from "@aop/common";
import type { Kysely } from "kysely";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { FAKE_SLACK_TOKENS, type FakeSlack, startFakeSlack } from "./sources/slack/fake-slack.ts";
import { createTestHostInbox, eventually } from "./test-utils.ts";

const TOKENS = { userToken: FAKE_SLACK_TOKENS.user, appToken: FAKE_SLACK_TOKENS.app };

describe("the Inbox page's actions", () => {
  let db: Kysely<Database>;
  let slack: FakeSlack;
  let inbox: ReturnType<typeof createTestHostInbox>;

  beforeEach(async () => {
    db = await createTestDb();
    slack = startFakeSlack();
    inbox = createTestHostInbox(createCommandContext(db), { slack });
    await inbox.host.slack.connect(TOKENS);
    await eventually(
      () => slack.sockets(),
      (count) => count === 1,
    );
  });

  afterEach(async () => {
    await inbox.close();
    slack.stop();
    await db.destroy();
  });

  const itemFor = async (text: string): Promise<InboxItem> => {
    const page = await eventually(
      () => inbox.host.inbox.list("needs-me", {}),
      (result) => result.success && result.page.items.some((item) => item.text.includes(text)),
    );
    const item = page.success ? page.page.items.find((found) => found.text.includes(text)) : null;
    if (!item) throw new Error(`no item for ${text}`);
    return item;
  };

  const threadWithMention = () => {
    const parent = slack.say({ channel: "C0INFRA", user: "U0DEV", text: "deploy check failed" });
    for (const text of ["probe too early", "5s budget", "on small runners"]) {
      slack.say({ channel: "C0INFRA", user: "U0ANA", text, threadTs: parent.ts });
    }
    slack.say({
      channel: "C0INFRA",
      user: "U0PRIYA",
      text: "<@U0ME> can you take it?",
      threadTs: parent.ts,
    });
    return parent;
  };

  test("an item opened reads its thread: the parent and the last three replies", async () => {
    threadWithMention();
    const item = await itemFor("can you take it");
    const recent = await inbox.host.actions.context(item.id, false);
    if (!recent.success) throw new Error("no context");
    expect(recent.context.parent?.text).toBe("deploy check failed");
    expect(recent.context.messages.map((message) => message.text)).toEqual([
      "5s budget",
      "on small runners",
      "@Marcelo can you take it?",
    ]);
    expect(recent.context.earlier).toBe(1);
    const all = await inbox.host.actions.context(item.id, true);
    expect(all.success && all.context.messages).toHaveLength(4);
  });

  test("a reply goes to the item's thread as the person, marked as sent from AOP", async () => {
    const parent = threadWithMention();
    const item = await itemFor("can you take it");
    const sent = await inbox.host.actions.reply(item.id, { text: "On it", broadcast: true });
    if (!sent.success) throw new Error("not sent");
    expect(sent.message).toMatchObject({ text: "On it", fromMe: true, fromAop: true });
    expect(sent.item.state).toBe("read");
    const posted = slack.calls.find((call) => call.method === "chat.postMessage");
    expect(posted?.params).toMatchObject({
      channel: "C0INFRA",
      thread_ts: parent.ts,
      reply_broadcast: "true",
      text: "On it",
    });
    const context = await inbox.host.actions.context(item.id, false);
    expect(context.success && context.context.messages.at(-1)?.fromAop).toBe(true);
  });

  test("a DM reply goes to the DM itself, and Slack's refusals read plainly", async () => {
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "still on for 3?" });
    const item = await itemFor("still on for 3");
    await inbox.host.actions.reply(item.id, { text: "yes", broadcast: true });
    const posted = slack.calls.find((call) => call.method === "chat.postMessage");
    expect(posted?.params.thread_ts).toBeUndefined();
    expect(posted?.params.reply_broadcast).toBeUndefined();

    slack.failNext("chat.postMessage", { error: "is_archived" });
    expect(await inbox.host.actions.reply(item.id, { text: "again", broadcast: false })).toEqual({
      success: false,
      error: { code: "SOURCE_FAILED", message: "this DM is archived." },
    });
    slack.failNext("chat.postMessage", { retryAfter: 60 });
    const limited = await inbox.host.actions.reply(item.id, { text: "again", broadcast: false });
    expect(!limited.success && limited.error).toEqual({
      code: "SOURCE_FAILED",
      message: "Slack asked to slow down: try again in 60 s",
    });
  });

  test("rules: a muted channel stores nothing, and a mapped channel filters by project", async () => {
    expect(await inbox.host.actions.rules()).toEqual(INBOX_DEFAULT_RULES);
    await inbox.host.actions.setRules({
      ...INBOX_DEFAULT_RULES,
      channels: {
        C0RANDOM: { mode: "muted", name: "random" },
        C0INFRA: { mode: "all", name: "infra", projectId: "proj_aop" },
      },
    });
    slack.say({ channel: "C0RANDOM", user: "U0SAM", text: "<@U0ME> muted mention" });
    slack.say({ channel: "C0INFRA", user: "U0PRIYA", text: "<@U0ME> infra mention" });
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "a DM" });
    await itemFor("a DM");
    await itemFor("infra mention");

    const all = await inbox.host.actions.list("needs-me", {});
    expect(all.success && all.page.items.map((item) => item.text)).toEqual([
      "a DM",
      "@Marcelo infra mention",
    ]);
    const mapped = await inbox.host.actions.list("needs-me", { projectId: "proj_aop" });
    expect(mapped.success && mapped.page.items.map((item) => item.text)).toEqual([
      "@Marcelo infra mention",
    ]);
    const none = await inbox.host.actions.list("needs-me", { projectId: "proj_other" });
    expect(none.success && none.page.items).toEqual([]);
  });

  test("lists the channels the person is in for the rules", async () => {
    const result = await inbox.host.actions.channels();
    expect(result.success && result.channels.map((channel) => channel.name)).toEqual([
      "design",
      "eng-announce",
      "infra",
      "ops",
      "platform",
      "random",
    ]);
  });

  test("the summary says whether Slack is connected and live", async () => {
    await eventually(
      () => inbox.host.actions.summary(),
      (summary) => summary.health === "live",
    );
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "count me" });
    const summary = await eventually(
      () => inbox.host.actions.summary(),
      (value) => value.unread === 1,
    );
    expect(summary).toEqual({ unread: 1, connected: true, health: "live" });
  });
});
