import type { SetupCheck, SlackConnection } from "@aop/common";

/**
 * "Slack Inbox": optional until the person connects Slack (AOP settings › Connections); then how
 * its live feed is doing, with the fix when Slack sends no events or refused the token.
 */
export const slackInboxCheck = (slack: SlackConnection | null, now: number): SetupCheck => {
  const link = { kind: "link", label: slack ? "Slack" : "Set up", target: "connections" } as const;
  if (!slack) {
    return {
      id: "slack-inbox",
      state: "optional",
      title: "Slack Inbox",
      detail: "Not set up: your Slack mentions, DMs and thread replies, in AOP",
      actions: [link],
    };
  }
  const who = `${slack.teamName} as @${slack.userName}`;
  return {
    id: "slack-inbox",
    state: STATE[slack.health],
    title: "Slack Inbox",
    detail: detailOf(slack, who, now),
    actions: [link],
  };
};

const STATE: Record<SlackConnection["health"], SetupCheck["state"]> = {
  live: "ok",
  connecting: "ok",
  offline: "warning",
  "no-events": "warning",
  revoked: "error",
};

const detailOf = (slack: SlackConnection, who: string, now: number): string => {
  switch (slack.health) {
    case "live":
    case "connecting":
      return slack.lastEventAt ? `${who} · last event ${ago(slack.lastEventAt, now)}` : who;
    case "no-events":
      return `${who}: connected, but Slack sends no events. Turn on Socket Mode, then Enable Events, and test again`;
    case "offline":
      return `${who}: reconnecting to Slack`;
    case "revoked":
      return `${who}: Slack refused the token. Reconnect in AOP settings › Connections`;
  }
};

const ago = (iso: string, now: number): string => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};
