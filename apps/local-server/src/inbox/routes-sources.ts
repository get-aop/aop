import {
  InboxNotificationsInputSchema,
  InboxRulesSchema,
  SlackDisconnectInputSchema,
  SlackSignInInputSchema,
  SlackTestInputSchema,
  SlackTokensInputSchema,
} from "@aop/common";
import type { Hono } from "hono";
import { readBody } from "../project/http.ts";
import type { HostInbox } from "./host-inbox.ts";
import { inboxError, slackError, slackErrorMessage } from "./route-errors.ts";
import { signInPage } from "./sources/slack/sign-in-page.ts";

/**
 * The Inbox's sources, rules and notifications. Tokens can be saved from any client and are
 * never sent back: GET says only which workspace is connected and how its feed is doing
 * (decision D3). The Host setup checklist reads the same `GET /sources`.
 */
export const addSourceRoutes = (routes: Hono, host: HostInbox): void => {
  const { actions, slack, notifier } = host;

  routes.get("/sources", async (c) => c.json(await actions.sources()));

  routes.put("/sources/slack", async (c) => {
    const parsed = await readBody(c, SlackTokensInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await slack.connect(parsed.body);
    return result.success ? c.json({ connection: result.connection }) : slackError(c, result.error);
  });

  routes.post("/sources/slack/sign-in", async (c) => {
    const parsed = await readBody(c, SlackSignInInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await slack.beginSignIn(parsed.body);
    return "error" in result
      ? c.json({ error: result.error, code: "INVALID_TOKENS" }, 400)
      : c.json(result);
  });

  // Public (auth/route-policy.ts): Slack sends the person's browser here, with no AOP session.
  // The single-use `state` the host made is what authenticates it.
  routes.get("/sources/slack/oauth/callback", async (c) => {
    const result = await slack.finishSignIn({
      code: c.req.query("code"),
      state: c.req.query("state"),
      error: c.req.query("error"),
    });
    return c.html(
      signInPage(result.success ? null : (slackErrorMessage(result.error) ?? "")),
      result.success ? 200 : 400,
    );
  });

  routes.post("/sources/slack/import", async (c) => {
    const result = await slack.importSpike();
    return result.success ? c.json({ connection: result.connection }) : slackError(c, result.error);
  });

  routes.post("/sources/slack/test", async (c) => {
    const parsed = await readBody(c, SlackTestInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await slack.test(parsed.body);
    return result.success ? c.json({ report: result.report }) : slackError(c, result.error);
  });

  routes.delete("/sources/slack", async (c) => {
    const parsed = SlackDisconnectInputSchema.safeParse({
      deleteMessages: c.req.query("deleteMessages") === "1",
    });
    await slack.disconnect(parsed.success && parsed.data.deleteMessages);
    return c.json({ ok: true });
  });

  routes.put("/sources/slack/notifications", async (c) => {
    const parsed = await readBody(c, InboxNotificationsInputSchema);
    if ("response" in parsed) return parsed.response;
    const result = await slack.setNotifications(parsed.body.mode);
    return result.success ? c.json({ connection: result.connection }) : slackError(c, result.error);
  });

  routes.get("/sources/slack/channels", async (c) => {
    const result = await actions.channels();
    return result.success ? c.json({ channels: result.channels }) : inboxError(c, result.error);
  });

  routes.get("/rules", async (c) => c.json({ rules: await actions.rules() }));

  routes.put("/rules", async (c) => {
    const parsed = await readBody(c, InboxRulesSchema);
    if ("response" in parsed) return parsed.response;
    const result = await actions.setRules(parsed.body);
    return result.success ? c.json({ rules: result.rules }) : inboxError(c, result.error);
  });

  // The desktop app asks every few seconds; without `after` it gets the cursor to start from.
  routes.get("/notifications", (c) => {
    const after = Number.parseInt(c.req.query("after") ?? "", 10);
    return c.json(notifier.page(Number.isFinite(after) ? after : null));
  });
};
