import {
  INBOX_DEFAULT_RULES,
  type InboxItem,
  type InboxRules,
  type InboxSources,
  type SlackConnection,
} from "@aop/common";
import { type ApiCall, mockApi } from "../test/mock-api";

export const makeInboxItem = (patch: Partial<InboxItem> = {}): InboxItem => ({
  id: "inbx_1",
  sourceId: "slack:T1",
  conversation: { id: "C1", name: "infra", kind: "channel" },
  threadId: "1700000000.000100",
  messageId: "1700000000.000500",
  author: { id: "U2", name: "Priya Rao", avatarUrl: null },
  text: "@Marcelo can you take the flaky deploy check? logs https://ci.dev/1",
  reason: "mention",
  messageCount: 1,
  state: "unread",
  snoozedUntil: null,
  permalink: "https://acme.slack.com/archives/C1/p1700000000000500",
  deleted: false,
  expired: false,
  receivedAt: "2026-10-03T10:42:00.000Z",
  links: [],
  ...patch,
});

export const makeSlackConnection = (patch: Partial<SlackConnection> = {}): SlackConnection => ({
  sourceId: "slack:T1",
  teamId: "T1",
  teamName: "Acme",
  teamUrl: "https://acme.slack.com/",
  userId: "U1",
  userName: "Marcelo",
  connectedAt: "2026-10-03T09:00:00.000Z",
  health: "live",
  lastEventAt: null,
  problem: null,
  missingScopes: [],
  notifications: "off",
  ...patch,
});

/**
 * A host with an Inbox: answers the Inbox's routes from `host`, which a test changes, and
 * records every call. `extra` answers anything else (projects, issues).
 */
export const installInboxHost = (
  extra: (call: ApiCall) => Response | undefined = () => undefined,
) => {
  const host = {
    items: [makeInboxItem()] as InboxItem[],
    sources: { slack: makeSlackConnection(), slackImportAvailable: false } as InboxSources,
    rules: INBOX_DEFAULT_RULES as InboxRules,
  };
  const replace = (item: InboxItem) => {
    host.items = host.items.map((entry) => (entry.id === item.id ? item : entry));
    return Response.json({ item });
  };
  const routes: Record<string, (call: ApiCall) => Response> = {
    "/inbox/summary": () =>
      Response.json({
        unread: host.items.filter((item) => item.state === "unread").length,
        connected: host.sources.slack !== null,
        health: host.sources.slack?.health ?? null,
      }),
    "/inbox/items": (call) => {
      const done = call.path.includes("view=done");
      return Response.json({
        items: host.items.filter((item) => (item.state === "done") === done),
        nextCursor: null,
      });
    },
    "/inbox/sources": () => Response.json(host.sources),
    "/inbox/rules": (call) => {
      if (call.method === "PUT") host.rules = call.body as InboxRules;
      return Response.json({ rules: host.rules });
    },
  };
  const itemRoutes: Record<string, (item: InboxItem, call: ApiCall) => Response> = {
    "": (item) => Response.json({ item }),
    "/state": (item, call) => {
      const body = call.body as { state: InboxItem["state"]; until?: string };
      return replace({ ...item, state: body.state, snoozedUntil: body.until ?? null });
    },
    "/context": () => Response.json({ context: CONTEXT }),
  };
  const api = mockApi((call) => {
    const path = call.path.split("?")[0] ?? "";
    const route = routes[path];
    if (route) return route(call);
    const [, id = "", rest = ""] = /^\/inbox\/items\/([^/]+)(\/[a-z]+)?$/.exec(path) ?? [];
    const item = host.items.find((candidate) => candidate.id === id);
    const itemRoute = itemRoutes[rest];
    if (item && itemRoute) return itemRoute(item, call);
    return extra(call);
  });
  return { host, api };
};

const CONTEXT = {
  parent: {
    id: "1700000000.000100",
    author: { id: "U3", name: "Dev Patel", avatarUrl: null },
    text: "deploy-check failed again",
    sentAt: "2026-10-03T09:58:00.000Z",
    fromMe: false,
    fromAop: false,
  },
  messages: [],
  earlier: 2,
};
