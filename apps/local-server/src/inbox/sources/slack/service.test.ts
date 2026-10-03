import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { createCommandContext } from "../../../context.ts";
import type { Database } from "../../../db/schema.ts";
import { createTestDb } from "../../../db/test-utils.ts";
import { createTestHostInbox, eventually } from "../../test-utils.ts";
import { TEST_MESSAGE } from "./connection-test.ts";
import { FAKE_SLACK_TOKENS, type FakeSlack, startFakeSlack } from "./fake-slack.ts";

const TOKENS = { userToken: FAKE_SLACK_TOKENS.user, appToken: FAKE_SLACK_TOKENS.app };

describe("connecting Slack", () => {
  let db: Kysely<Database>;
  let slack: FakeSlack;
  let inbox: ReturnType<typeof createTestHostInbox>;

  beforeEach(async () => {
    db = await createTestDb();
    slack = startFakeSlack();
    inbox = createTestHostInbox(createCommandContext(db), { slack, testWaitMs: 2_000 });
  });

  afterEach(async () => {
    await inbox.close();
    slack.stop();
    await db.destroy();
  });

  test("saves the tokens owner-only on the host and never shows them", async () => {
    const connected = await inbox.host.slack.connect(TOKENS);
    if (!connected.success) throw new Error("not connected");
    expect(connected.connection).toMatchObject({
      sourceId: "slack:T0FAKE",
      teamName: "Acme",
      userName: "Marcelo",
      missingScopes: [],
      notifications: "off",
    });
    expect(JSON.stringify(await inbox.host.actions.sources())).not.toContain("xoxp-");

    const dir = join(inbox.dir, "connections");
    const file = join(dir, "T0FAKE.json");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).userToken).toBe(FAKE_SLACK_TOKENS.user);
  });

  test("refuses tokens of the wrong kind or that Slack refuses", async () => {
    const bot = await inbox.host.slack.connect({ ...TOKENS, userToken: "xoxb-1" });
    expect(bot).toMatchObject({ success: false, error: { code: "INVALID_TOKENS" } });
    const refused = await inbox.host.slack.connect({ ...TOKENS, appToken: "xapp-wrong" });
    expect(refused).toMatchObject({
      success: false,
      error: { message: "Slack refused the app-level token (invalid_auth)." },
    });
    expect(await inbox.host.slack.connection()).toBeNull();
  });

  test("the test passes only when a real message arrives, and deletes its own", async () => {
    const result = await inbox.host.slack.test({ ...TOKENS, sendTestMessage: true });
    if (!result.success) throw new Error("no report");
    expect(result.report.ok).toBe(true);
    expect(result.report.checks.map((check) => [check.id, check.ok])).toEqual([
      ["user-token", true],
      ["scopes", true],
      ["app-token", true],
      ["groups", true],
      ["events", true],
    ]);
    expect(result.report.checks[0]?.detail).toBe("Acme (T0FAKE) as @marcelo");
    expect(result.report.checks[3]?.detail).toBe("1 group you're in");
    // Posted to the person's own DM only, and deleted once it arrived.
    expect(slack.posted.map((message) => message.text)).toEqual([TEST_MESSAGE]);
    expect(slack.calls.find((call) => call.method === "chat.postMessage")?.params.channel).toBe(
      "U0ME",
    );
    expect(slack.deleted).toEqual([slack.posted[0]?.ts ?? ""]);
    expect(slack.messages("D0SELF")).toEqual([]);
  });

  test("hears the test message on the running feed's socket too", async () => {
    await inbox.host.slack.connect(TOKENS);
    await eventually(
      () => slack.sockets(),
      (count) => count === 1,
    );
    const result = await inbox.host.slack.test({ sendTestMessage: true });
    expect(result.success && result.report.ok).toBe(true);
  });

  test("fails with the fix when Slack connects but sends no events", async () => {
    slack.setEvents(false);
    const result = await inbox.host.slack.test({ ...TOKENS, sendTestMessage: true });
    if (!result.success) throw new Error("no report");
    const events = result.report.checks.find((check) => check.id === "events");
    expect(result.report.ok).toBe(false);
    expect(events?.ok).toBe(false);
    expect(events?.fix).toContain("Settings › Socket Mode and turn it on");
    expect(slack.deleted).toHaveLength(1);
  });

  test("names each wrong token and what to do", async () => {
    const result = await inbox.host.slack.test({
      userToken: "xoxb-bot",
      appToken: "xoxp-user",
      sendTestMessage: false,
    });
    if (!result.success) throw new Error("no report");
    expect(result.report.checks.map((check) => [check.id, check.ok, check.detail])).toEqual([
      ["user-token", false, "That is a bot token (xoxb-)"],
      ["scopes", null, "Not checked"],
      ["app-token", false, "An app-level token starts with xapp-"],
      ["groups", null, "Not checked"],
      ["events", null, "Not checked"],
    ]);
    expect(await inbox.host.slack.test({ sendTestMessage: false })).toEqual({
      success: false,
      error: { code: "NOT_CONNECTED" },
    });
  });

  test("lists the scopes a token lacks with how to add them", async () => {
    slack.stop();
    slack = startFakeSlack({ scopes: ["channels:history", "users:read"] });
    await inbox.close();
    inbox = createTestHostInbox(createCommandContext(db), { slack, testWaitMs: 500 });
    const result = await inbox.host.slack.test({ ...TOKENS, sendTestMessage: false });
    if (!result.success) throw new Error("no report");
    const scopes = result.report.checks.find((check) => check.id === "scopes");
    expect(scopes?.detail).toStartWith("2 of 13 scopes; missing groups:history");
    expect(scopes?.fix).toContain("User Token Scopes, then Reinstall");
  });

  test("imports the connection test's tokens once, then deletes that folder", async () => {
    const spike = join(inbox.dir, "spike");
    expect(await inbox.host.slack.importAvailable()).toBe(false);
    mkdirSync(spike, { mode: 0o700 });
    writeFileSync(
      join(spike, "tokens.env"),
      `SLACK_USER_TOKEN=${TOKENS.userToken}\nSLACK_APP_TOKEN=${TOKENS.appToken}\n`,
      { mode: 0o600 },
    );
    writeFileSync(join(spike, "listen.ts"), "// the test's listener");
    expect((await inbox.host.actions.sources()).slackImportAvailable).toBe(true);

    const imported = await inbox.host.slack.importSpike();
    expect(imported.success).toBe(true);
    expect(readdirSync(inbox.dir)).not.toContain("spike");
    expect(await inbox.host.slack.importSpike()).toEqual({
      success: false,
      error: { code: "NO_IMPORT" },
    });
  });

  test("disconnecting stops the feed and can delete what it stored", async () => {
    await inbox.host.slack.connect(TOKENS);
    await eventually(
      () => slack.sockets(),
      (count) => count === 1,
    );
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "hi" });
    await eventually(
      () => inbox.host.inbox.unread(),
      (count) => count === 1,
    );

    await inbox.host.slack.disconnect(false);
    expect(await inbox.host.slack.connection()).toBeNull();
    await eventually(
      () => slack.sockets(),
      (count) => count === 0,
    );
    expect(await inbox.host.inbox.unread()).toBe(1);

    await inbox.host.slack.connect(TOKENS);
    await inbox.host.slack.disconnect(true);
    expect(await inbox.host.inbox.unread()).toBe(0);
    expect(readdirSync(join(inbox.dir, "connections"))).toEqual([]);
  });

  test("notifications are off until the person picks a mode", async () => {
    expect(await inbox.host.slack.setNotifications("all")).toEqual({
      success: false,
      error: { code: "NOT_CONNECTED" },
    });
    await inbox.host.slack.connect(TOKENS);
    const changed = await inbox.host.slack.setNotifications("away");
    expect(changed.success && changed.connection.notifications).toBe("away");
  });
});
