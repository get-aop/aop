import { describe, expect, test } from "bun:test";
import type { SlackConnection } from "@aop/common";
import { slackInboxCheck } from "./slack-inbox-check.ts";

const NOW = Date.parse("2026-10-03T10:00:00.000Z");

const slack = (patch: Partial<SlackConnection> = {}): SlackConnection => ({
  sourceId: "slack:T1",
  teamId: "T1",
  teamName: "Acme",
  teamUrl: "https://acme.slack.com/",
  userId: "U1",
  userName: "marcelo",
  connectedAt: "2026-10-03T09:00:00.000Z",
  health: "live",
  lastEventAt: "2026-10-03T09:58:00.000Z",
  problem: null,
  missingScopes: [],
  notifications: "off",
  ...patch,
});

describe("the Slack Inbox row", () => {
  test("is optional until Slack is connected, with a way to set it up", () => {
    expect(slackInboxCheck(null, NOW)).toEqual({
      id: "slack-inbox",
      state: "optional",
      title: "Slack Inbox",
      detail: "Not set up: your Slack mentions, DMs and thread replies, in AOP",
      actions: [{ kind: "link", label: "Set up", target: "connections" }],
    });
  });

  test("says who and the last event when live", () => {
    const check = slackInboxCheck(slack(), NOW);
    expect(check.state).toBe("ok");
    expect(check.detail).toBe("Acme as @marcelo · last event 2 min ago");
  });

  test("turns amber with the fix when Slack sends no events, red when it refused the token", () => {
    const quiet = slackInboxCheck(slack({ health: "no-events" }), NOW);
    expect(quiet.state).toBe("warning");
    expect(quiet.detail).toContain("Turn on Socket Mode");
    const revoked = slackInboxCheck(slack({ health: "revoked" }), NOW);
    expect(revoked.state).toBe("error");
    expect(revoked.detail).toContain("Reconnect");
  });
});
