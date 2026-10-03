import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { InboxItemPageSchema, InboxItemSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { routeAccess } from "../auth/route-policy.ts";
import { createLoopbackApp } from "../auth/test-utils.ts";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createTestHostInbox, incomingMessage } from "./test-utils.ts";

describe("Inbox routes", () => {
  let db: Kysely<Database>;
  let testInbox: ReturnType<typeof createTestHostInbox>;
  let app: ReturnType<typeof createLoopbackApp>;

  beforeEach(async () => {
    db = await createTestDb();
    const ctx = createCommandContext(db);
    testInbox = createTestHostInbox(ctx);
    app = createLoopbackApp({ ctx, startTimeMs: Date.now(), inbox: testInbox.host });
  });

  afterEach(async () => {
    await testInbox.close();
    await db.destroy();
  });

  const send = (path: string, method: string, body?: unknown) =>
    app.request(`http://127.0.0.1:25150/api/inbox${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const seedItem = async () => {
    const item = await testInbox.host.inbox.ingest(incomingMessage({ mentionsMe: true }));
    return item?.id ?? "";
  };

  test("lists a view, reads an item and counts what is unread", async () => {
    const id = await seedItem();

    const list = await send("/items?view=mentions", "GET");
    expect(list.status).toBe(200);
    const page = InboxItemPageSchema.parse(await list.json());
    expect(page.items.map((item) => item.id)).toEqual([id]);
    expect(page.nextCursor).toBeNull();

    const one = await send(`/items/${id}`, "GET");
    expect(InboxItemSchema.parse(((await one.json()) as { item: unknown }).item).id).toBe(id);
    expect(await (await send("/summary", "GET")).json()).toEqual({
      unread: 1,
      connected: false,
      health: null,
    });
  });

  test("marks done, snoozes and refuses a bad state", async () => {
    const id = await seedItem();

    const done = await send(`/items/${id}/state`, "PUT", { state: "done" });
    expect(done.status).toBe(200);
    expect(((await (await send("/summary", "GET")).json()) as { unread: number }).unread).toBe(0);

    const snoozed = await send(`/items/${id}/state`, "PUT", {
      state: "snoozed",
      until: "2099-10-02T09:00:00Z",
    });
    expect(((await snoozed.json()) as { item: { state: string } }).item.state).toBe("snoozed");

    expect((await send(`/items/${id}/state`, "PUT", { state: "snoozed" })).status).toBe(400);
    expect((await send(`/items/${id}/state`, "PUT", { state: "archived" })).status).toBe(400);
  });

  test("links and unlinks an item", async () => {
    const id = await seedItem();

    const added = await send(`/items/${id}/links`, "POST", {
      kind: "pull-request",
      ref: "get-aop/aop#71",
      url: "https://github.com/get-aop/aop/pull/71",
    });
    expect(added.status).toBe(201);
    const { item } = (await added.json()) as { item: { links: { id: string; ref: string }[] } };
    expect(item.links.map((link) => link.ref)).toEqual(["get-aop/aop#71"]);

    const removed = await send(`/items/${id}/links/${item.links[0]?.id}`, "DELETE");
    expect(((await removed.json()) as { item: { links: unknown[] } }).item.links).toEqual([]);

    expect((await send(`/items/${id}/links`, "POST", { kind: "issue", ref: "" })).status).toBe(400);
    expect(
      (await send(`/items/${id}/links`, "POST", { kind: "issue", ref: "x", url: "nope" })).status,
    ).toBe(400);
  });

  test("answers 404 for an unknown item and 400 for an unknown view or cursor", async () => {
    expect((await send("/items/inbx_missing", "GET")).status).toBe(404);
    expect((await send("/items/inbx_missing/state", "PUT", { state: "done" })).status).toBe(404);
    expect((await send("/items/inbx_missing/links/inlk_1", "DELETE")).status).toBe(404);
    expect((await send("/items?view=everything", "GET")).status).toBe(400);
    expect((await send("/items?cursor=nope", "GET")).status).toBe(400);
  });

  test("sources, rules and notifications: nothing to show until Slack is connected", async () => {
    expect(await (await send("/sources", "GET")).json()).toEqual({
      slack: null,
      slackImportAvailable: false,
    });
    const rules = (await (await send("/rules", "GET")).json()) as { rules: unknown };
    expect(rules.rules).toMatchObject({ mentions: true, keywords: [] });
    expect((await send("/rules", "PUT", rules.rules)).status).toBe(409);
    expect((await send("/sources/slack/notifications", "PUT", { mode: "all" })).status).toBe(409);
    expect((await send("/sources/slack/channels", "GET")).status).toBe(409);
    expect((await send("/sources/slack/import", "POST")).status).toBe(404);
    expect(
      (await send("/sources/slack", "PUT", { userToken: "xoxb-1", appToken: "x" })).status,
    ).toBe(400);
    expect((await send("/sources/slack", "DELETE")).status).toBe(200);
    expect(await (await send("/notifications", "GET")).json()).toEqual({
      cursor: 0,
      notifications: [],
    });
  });

  test("the sign-in callback answers a page, and refuses a state it did not make", async () => {
    const response = await send("/sources/slack/oauth/callback?code=x&state=forged", "GET");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Slack is not connected");
    const bad = await send("/sources/slack/sign-in", "POST", {
      clientId: "abc",
      appToken: "xapp-1",
      redirectUrl: "https://host/api/inbox/sources/slack/oauth/callback",
    });
    expect(bad.status).toBe(400);
  });

  test("a paired device may read and triage the Inbox", () => {
    // Slack sends the browser back with no session: the one-time state authenticates it.
    expect(routeAccess("GET", "/api/inbox/sources/slack/oauth/callback")).toBe("public");
    // Tokens may be saved from a device (decision D3); they are never sent back.
    expect(routeAccess("PUT", "/api/inbox/sources/slack")).toBe("device");
    expect(routeAccess("POST", "/api/inbox/items/inbx_1/reply")).toBe("device");
    expect(routeAccess("GET", "/api/inbox/items")).toBe("device");
    expect(routeAccess("GET", "/api/inbox/summary")).toBe("device");
    expect(routeAccess("PUT", "/api/inbox/items/inbx_1/state")).toBe("device");
    expect(routeAccess("POST", "/api/inbox/items/inbx_1/links")).toBe("device");
  });
});
