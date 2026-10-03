import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { InboxItem } from "@aop/common";
import type { Kysely } from "kysely";
import { createCommandContext } from "../../../context.ts";
import type { Database } from "../../../db/schema.ts";
import { createTestDb } from "../../../db/test-utils.ts";
import { createTestHostInbox, eventually } from "../../test-utils.ts";
import { FAKE_SLACK_TOKENS, type FakeSlack, startFakeSlack } from "./fake-slack.ts";
import type { WebSocketLike } from "./socket.ts";

const TOKENS = { userToken: FAKE_SLACK_TOKENS.user, appToken: FAKE_SLACK_TOKENS.app };

describe("the Slack feed", () => {
  let db: Kysely<Database>;
  let slack: FakeSlack;
  let inbox: ReturnType<typeof createTestHostInbox>;
  // The feed and the fake Slack share a clock that stands still unless a test moves it, so
  // whether a message fell inside a socket's open window never depends on the machine's speed.
  let clock: { ms: number };
  const now = () => clock.ms;

  beforeEach(async () => {
    db = await createTestDb();
    clock = { ms: Date.now() };
    slack = startFakeSlack({ now });
  });

  afterEach(async () => {
    await inbox.close();
    slack.stop();
    await db.destroy();
  });

  const connect = async () => {
    inbox = createTestHostInbox(createCommandContext(db), { slack, now });
    const connected = await inbox.host.slack.connect(TOKENS);
    expect(connected.success).toBe(true);
    await eventually(
      async () => (await inbox.host.slack.connection())?.health,
      (health) => health === "live",
    );
  };

  const items = async (): Promise<InboxItem[]> => {
    const page = await inbox.host.inbox.list("needs-me", {});
    return page.success ? page.page.items : [];
  };

  const settled = (count: number) => eventually(items, (list) => list.length === count);

  test("keeps the messages that need the person, as their own reasons, and drops the rest", async () => {
    await connect();
    slack.say({ channel: "C0RANDOM", user: "U0SAM", text: "lunch?" });
    slack.say({
      channel: "C0INFRA",
      user: "U0PRIYA",
      text: "<@U0ME> can you take the deploy check?",
    });
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "still on for 3?" });
    slack.say({ channel: "C0ANNOUNCE", user: "U0ANA", text: "<!here> staging DB maintenance" });
    slack.say({
      channel: "C0DESIGN",
      user: "U0SAM",
      text: "<!subteam^S0PLATFORM|@platform-team> new tokens",
    });
    slack.say({ channel: "C0DESIGN", user: "U0SAM", text: "<!subteam^S0ONCALL|@oncall> not you" });

    const list = await settled(4);
    expect(list.map((item) => [item.conversation.name, item.reason, item.author.name])).toEqual([
      ["design", "group", "Sam Ortiz"],
      ["eng-announce", "broadcast", "Ana Kovač"],
      ["Jonas Lind", "dm", "Jonas Lind"],
      ["infra", "mention", "Priya Rao"],
    ]);
    const mention = list[3];
    expect(mention?.text).toBe("@Marcelo can you take the deploy check?");
    expect(mention?.permalink).toStartWith(`${slack.origin}/archives/C0INFRA/p`);
    // Only matches are stored; the lunch question never was.
    expect(JSON.stringify(list)).not.toContain("lunch");
  });

  test("follows threads the person is in, edits and deletes", async () => {
    await connect();
    const parent = slack.say({
      channel: "C0PLATFORM",
      user: "U0ME",
      text: "retry backoff PR is up",
    });
    slack.say({
      channel: "C0PLATFORM",
      user: "U0MEI",
      text: "merged, one nit",
      threadTs: parent.ts,
    });
    const [reply] = await settled(1);
    expect(reply?.reason).toBe("thread-reply");
    expect(reply?.threadId).toBe(parent.ts);

    slack.edit("C0PLATFORM", reply?.messageId ?? "", "merged, two nits");
    await eventually(items, (list) => list[0]?.text === "merged, two nits");
    slack.remove("C0PLATFORM", reply?.messageId ?? "");
    const [gone] = await eventually(items, (list) => list[0]?.deleted === true);
    expect(gone?.text).toBe("");
  });

  test("reads what it missed while it was not listening, then follows live", async () => {
    inbox = createTestHostInbox(createCommandContext(db), { slack, now });
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "sent while AOP was off" });
    await inbox.host.slack.connect(TOKENS);
    const [missed] = await settled(1);
    expect(missed?.text).toBe("sent while AOP was off");

    slack.drop();
    await eventually(
      async () => (await inbox.host.slack.connection())?.health,
      (health) => health === "offline",
    );
    await eventually(
      () => slack.sockets(),
      (count) => count === 1,
      5_000,
    );
    slack.say({ channel: "C0INFRA", user: "U0PRIYA", text: "<@U0ME> back?" });
    await settled(2);
  });

  test("a refreshed socket opens the next one first and nothing is lost", async () => {
    await connect();
    slack.refresh();
    await eventually(
      () => slack.sockets(),
      (count) => count === 1,
    );
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "after the refresh" });
    await settled(1);
    expect((await inbox.host.slack.connection())?.health).toBe("live");
  });

  test("says when Slack connects but sends no events (Socket Mode off)", async () => {
    await connect();
    slack.setEvents(false);
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "this event never comes" });
    // Long enough after the message that Slack would have delivered it.
    clock.ms += 5_100;
    slack.refresh();
    const connection = await eventually(
      () => inbox.host.slack.connection(),
      (value) => value?.health === "no-events",
    );
    expect(connection?.problem).toContain("Socket Mode");
    // The catch-up read keeps the Inbox filling, late.
    expect((await items()).map((item) => item.text)).toEqual(["this event never comes"]);
  });

  test("a socket that reconnects while a catch-up runs is still checked, after it", async () => {
    const sockets: ScriptedSocket[] = [];
    inbox = createTestHostInbox(createCommandContext(db), {
      slack,
      now,
      createSocket: () => {
        const socket = scriptedSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const firstRead = slack.holdNext("users.conversations");
    await inbox.host.slack.connect(TOKENS);
    await eventually(
      () => sockets.length,
      (count) => count === 1,
    );
    sockets[0]?.receive({ type: "hello" });
    await firstRead.reached;

    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "this event never comes" });
    clock.ms += 5_100;
    sockets[0]?.receive({ type: "disconnect", reason: "refresh_requested" });
    await eventually(
      () => sockets.length,
      (count) => count === 2,
    );
    // The quiet socket's check is asked for while the first read still waits on Slack.
    sockets[1]?.receive({ type: "hello" });
    firstRead.release();

    const connection = await eventually(
      () => inbox.host.slack.connection(),
      (value) => value?.health === "no-events",
    );
    expect(connection?.problem).toContain("Socket Mode");
    expect((await items()).map((item) => item.text)).toEqual(["this event never comes"]);
  });

  test("stops and says so when Slack refuses the app token", async () => {
    await connect();
    slack.failNext("apps.connections.open", { error: "token_revoked" });
    slack.drop();
    const connection = await eventually(
      () => inbox.host.slack.connection(),
      (value) => value?.health === "revoked",
      5_000,
    );
    expect(connection?.problem).toContain("token_revoked");
  });
});

interface ScriptedSocket extends WebSocketLike {
  receive: (envelope: Record<string, unknown>) => void;
}

/** A Socket Mode socket the test speaks for, so it decides when each envelope arrives. */
const scriptedSocket = (): ScriptedSocket => {
  const socket: ScriptedSocket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: () => undefined,
    close: () => socket.onclose?.({ code: 1000 }),
    receive: (envelope) => socket.onmessage?.({ data: JSON.stringify(envelope) }),
  };
  return socket;
};
