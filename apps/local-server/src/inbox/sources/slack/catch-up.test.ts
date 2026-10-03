import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { catchUp } from "./catch-up.ts";
import { createSlackDirectory } from "./directory.ts";
import { FAKE_SLACK_TOKENS, type FakeSlack, startFakeSlack } from "./fake-slack.ts";
import { createSlackWebApi } from "./web-api.ts";

describe("catch-up", () => {
  let slack: FakeSlack;
  beforeEach(() => {
    slack = startFakeSlack();
  });
  afterEach(() => slack.stop());

  const run = (since: string, known: Set<string>, waits: number[]) => {
    const api = createSlackWebApi({ url: slack.apiUrl, maxWaitMs: 0 });
    const handled: string[] = [];
    return catchUp(since, {
      api,
      token: FAKE_SLACK_TOKENS.user,
      directory: createSlackDirectory({ api, token: FAKE_SLACK_TOKENS.user, me: "U0ME" }),
      handle: async (channel, message) => {
        handled.push(`${channel}:${message.text}`);
      },
      isKnownThread: async (channel, ts) => known.has(`${channel}:${ts}`),
      knownThreads: async () => [],
      stopped: () => false,
      pauseMs: 0,
      sleep: async (ms) => {
        if (ms > 0) waits.push(ms);
      },
    }).then((report) => ({ report, handled }));
  };

  test("reads DMs first, then channels, and replies only in threads the person is in", async () => {
    const since = "1000000000.000000";
    slack.say({ channel: "C0INFRA", user: "U0PRIYA", text: "channel message" });
    const mine = slack.say({ channel: "C0PLATFORM", user: "U0ME", text: "my thread" });
    slack.say({ channel: "C0PLATFORM", user: "U0MEI", text: "reply in mine", threadTs: mine.ts });
    const other = slack.say({ channel: "C0DESIGN", user: "U0SAM", text: "their thread" });
    slack.say({ channel: "C0DESIGN", user: "U0ANA", text: "reply in theirs", threadTs: other.ts });
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "a DM" });

    const { report, handled } = await run(since, new Set([`C0PLATFORM:${mine.ts}`]), []);
    expect(handled).toEqual([
      "D0JONAS:a DM",
      "C0INFRA:channel message",
      "C0PLATFORM:my thread",
      "C0PLATFORM:reply in mine",
      "C0DESIGN:their thread",
    ]);
    expect(report.timestamps).toHaveLength(5);
  });

  test("waits out Slack's slow-down and goes on", async () => {
    slack.say({ channel: "D0JONAS", user: "U0JONAS", text: "a DM" });
    slack.failNext("conversations.history", { retryAfter: 30 });
    const waits: number[] = [];
    const { handled } = await run("1000000000.000000", new Set(), waits);
    expect(waits).toEqual([30_000]);
    expect(handled).toEqual(["D0JONAS:a DM"]);
  });
});
