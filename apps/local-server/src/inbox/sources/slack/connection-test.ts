import {
  SLACK_USER_EVENTS,
  SLACK_USER_SCOPES,
  type SlackTestCheck,
  type SlackTestCheckId,
  type SlackTestReport,
} from "@aop/common";
import { record, text } from "./directory.ts";
import type { WebSocketLike } from "./socket.ts";
import {
  REVOKED_ERRORS,
  type SlackParams,
  type SlackReply,
  type SlackWebApi,
  slackError,
} from "./web-api.ts";

/**
 * The connection test. It passes only when a real message travels Slack → AOP: a socket that
 * connects and says hello proves nothing, since Slack does that even with Socket Mode off and
 * then never sends an event (the design's first test found exactly that). "Send it for me" posts
 * "AOP connection test" to the person's own DM, as them, and deletes it once it arrives.
 */
export interface SlackIdentity {
  teamId: string;
  teamName: string;
  teamUrl: string;
  userId: string;
  userName: string;
  scopes: string[];
}

export interface SlackTestDeps {
  api: SlackWebApi;
  createSocket?: (url: string) => WebSocketLike;
  /** Slack hands each event to one of the app's sockets: the running feed's may get the test's. */
  tapFeed: (teamId: string, listener: (event: Record<string, unknown>) => void) => () => void;
  waitMs?: number;
  helloWaitMs?: number;
  now?: () => number;
}

export interface SlackTestResult {
  report: SlackTestReport;
  identity: SlackIdentity | null;
}

export const TEST_MESSAGE = "AOP connection test";

export const NO_EVENTS_FIX =
  "Connected, but Slack sent no events. Open your app's Settings › Socket Mode and turn it on, then Event Subscriptions › Enable Events with the four user message events (" +
  SLACK_USER_EVENTS.join(", ") +
  "), Save, and Reinstall if Slack asks. Then test again.";

export const runSlackTest = async (
  tokens: { userToken: string; appToken: string },
  sendTestMessage: boolean,
  deps: SlackTestDeps,
): Promise<SlackTestResult> => {
  const checks = new Map<SlackTestCheckId, SlackTestCheck>();
  const note = (id: SlackTestCheckId, ok: boolean | null, detail: string, fix: string | null) =>
    checks.set(id, { id, ok, detail, fix });

  const identity = await checkUserToken(tokens.userToken, deps.api, note);
  if (identity) checkScopes(identity.scopes, note);
  const socket = await openTestSocket(tokens.appToken, deps, note);
  try {
    if (identity) await checkGroups(tokens.userToken, identity.userId, deps.api, note);
    if (identity && socket) {
      await checkEvents({ tokens, identity, socket, sendTestMessage, deps, note });
    }
  } finally {
    socket?.socket.close();
  }
  const report = {
    checks: (["user-token", "scopes", "app-token", "groups", "events"] as const).map(
      (id) => checks.get(id) ?? { id, ok: null, detail: "Not checked", fix: null },
    ),
    ok: false,
  };
  report.ok = report.checks.every((check) => check.ok === true);
  return { report, identity };
};

type Note = (id: SlackTestCheckId, ok: boolean | null, detail: string, fix: string | null) => void;

/** A user token that answers auth.test, and who it belongs to. Exported for "Save" too. */
export const readIdentity = async (
  userToken: string,
  api: SlackWebApi,
): Promise<SlackIdentity | { error: string }> => {
  const reply = await api.call("auth.test", userToken);
  const error = slackError(reply);
  if (error) return { error };
  const body = reply.body;
  return {
    teamId: text(body.team_id),
    teamName: text(body.team) || text(body.team_id),
    teamUrl: text(body.url),
    userId: text(body.user_id),
    userName: text(body.user) || text(body.user_id),
    scopes: reply.scopes ?? [],
  };
};

const checkUserToken = async (
  token: string,
  api: SlackWebApi,
  note: Note,
): Promise<SlackIdentity | null> => {
  const wrong = wrongUserToken(token);
  if (wrong) {
    note("user-token", false, wrong.detail, wrong.fix);
    return null;
  }
  const identity = await readIdentity(token, api).catch((cause: Error) => ({
    error: cause.message,
  }));
  if ("error" in identity) {
    note(
      "user-token",
      false,
      `Slack refused the user token (${identity.error})`,
      REVOKED_ERRORS.has(identity.error)
        ? "Copy the User OAuth Token again from OAuth & Permissions; if the app was removed, install it again."
        : null,
    );
    return null;
  }
  note(
    "user-token",
    true,
    `${identity.teamName} (${identity.teamId}) as @${identity.userName}`,
    null,
  );
  return identity;
};

const wrongUserToken = (token: string): { detail: string; fix: string } | null => {
  if (token.startsWith("xoxp-")) return null;
  if (token.startsWith("xoxb-")) {
    return {
      detail: "That is a bot token (xoxb-)",
      fix: "Paste the User OAuth Token from OAuth & Permissions, which starts with xoxp-.",
    };
  }
  if (token.startsWith("xapp-")) {
    return {
      detail: "That is the app-level token (xapp-)",
      fix: "It goes in the second field. The first takes the User OAuth Token (xoxp-).",
    };
  }
  return {
    detail: "A user token starts with xoxp-",
    fix: "Copy the User OAuth Token from your app's OAuth & Permissions page.",
  };
};

const checkScopes = (granted: string[], note: Note): void => {
  const missing = SLACK_USER_SCOPES.filter((scope) => !granted.includes(scope));
  if (missing.length === 0) {
    note("scopes", true, `${SLACK_USER_SCOPES.length} of ${SLACK_USER_SCOPES.length} scopes`, null);
    return;
  }
  note(
    "scopes",
    false,
    `${SLACK_USER_SCOPES.length - missing.length} of ${SLACK_USER_SCOPES.length} scopes; missing ${missing.join(", ")}`,
    `Add ${missing.join(", ")} under OAuth & Permissions › User Token Scopes, then Reinstall the app and copy the new user token.`,
  );
};

interface TestSocket {
  socket: WebSocketLike;
  events: Array<(event: Record<string, unknown>) => void>;
}

const openTestSocket = async (
  appToken: string,
  deps: SlackTestDeps,
  note: Note,
): Promise<TestSocket | null> => {
  if (!appToken.startsWith("xapp-")) {
    note(
      "app-token",
      false,
      "An app-level token starts with xapp-",
      "Basic Information › App-Level Tokens › Generate Token and Scopes, with the scope connections:write.",
    );
    return null;
  }
  const reply = await safeCall(deps.api, "apps.connections.open", appToken);
  const error = slackError(reply);
  if (error) {
    note("app-token", false, `Slack refused the app-level token (${error})`, appTokenFix(error));
    return null;
  }
  const createSocket = deps.createSocket ?? ((url) => new WebSocket(url) as WebSocketLike);
  const test: TestSocket = { socket: createSocket(text(reply.body.url)), events: [] };
  if (!(await waitForHello(test, deps.helloWaitMs ?? 10_000))) {
    test.socket.close();
    note("app-token", false, "Slack did not open a Socket Mode connection", null);
    return null;
  }
  note("app-token", true, "Socket Mode connected", null);
  return test;
};

/** Resolves on Slack's hello, false when it does not come or the socket closes. */
const waitForHello = (test: TestSocket, waitMs: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), waitMs);
    test.socket.onmessage = (frame) => {
      const envelope = record(safeJson(frame.data));
      if (receive(test, envelope)) {
        clearTimeout(timer);
        resolve(true);
      }
    };
    test.socket.onclose = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });

/** Acks an envelope and passes its event on; true for Slack's hello. */
const receive = (test: TestSocket, envelope: Record<string, unknown>): boolean => {
  if (typeof envelope.envelope_id === "string") {
    test.socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
  }
  if (envelope.type === "events_api") {
    const event = record(record(envelope.payload).event);
    for (const listener of test.events) listener(event);
  }
  return envelope.type === "hello";
};

const appTokenFix = (error: string): string => {
  if (error === "missing_scope") {
    return "Generate a new app-level token with the scope connections:write (Basic Information › App-Level Tokens).";
  }
  if (error === "not_allowed_token_type") {
    return "Paste the app-level token from Basic Information › App-Level Tokens, which starts with xapp-.";
  }
  return "Generate the app-level token again (Basic Information › App-Level Tokens, scope connections:write).";
};

const checkGroups = async (
  userToken: string,
  me: string,
  api: SlackWebApi,
  note: Note,
): Promise<void> => {
  const reply = await safeCall(api, "usergroups.list", userToken, { include_users: true });
  const error = slackError(reply);
  if (error === "missing_scope") {
    note(
      "groups",
      false,
      "Cannot read your groups",
      "Add usergroups:read under User Token Scopes and reinstall.",
    );
    return;
  }
  if (error) {
    // Free workspaces have no user groups; that is no reason to stop.
    note("groups", true, `No groups to read (${error})`, null);
    return;
  }
  const groups = Array.isArray(reply.body.usergroups) ? reply.body.usergroups : [];
  const mine = groups.filter((group) => {
    const users = record(group).users;
    return Array.isArray(users) && users.includes(me);
  }).length;
  note("groups", true, `${mine} ${mine === 1 ? "group" : "groups"} you're in`, null);
};

type Outcome = { ok: boolean; detail: string; fix: string | null };

const checkEvents = async (input: {
  tokens: { userToken: string; appToken: string };
  identity: SlackIdentity;
  socket: TestSocket;
  sendTestMessage: boolean;
  deps: SlackTestDeps;
  note: Note;
}): Promise<void> => {
  const { tokens, identity, socket, deps, note } = input;
  const now = deps.now ?? Date.now;
  // The event may come before chat.postMessage answers, so any message of the person's counts
  // until the test message's own id is known.
  const sent: { message: { channel: string; ts: string } | null } = { message: null };
  let resolveArrival: (at: number) => void = () => undefined;
  const arrival = new Promise<number>((resolve) => {
    resolveArrival = resolve;
  });
  const listener = (event: Record<string, unknown>) => {
    if (event.type !== "message" || text(event.user) !== identity.userId) return;
    if (sent.message && text(event.ts) !== sent.message.ts) return;
    resolveArrival(now());
  };
  socket.events.push(listener);
  const untap = deps.tapFeed(identity.teamId, listener);
  const started = now();
  let outcome: Outcome;
  try {
    outcome = await awaitArrival({ ...input, arrival, sent, started });
  } finally {
    untap();
  }
  const cleanup = sent.message
    ? await deleteTestMessage(tokens.userToken, sent.message, deps.api)
    : "";
  note("events", outcome.ok, `${outcome.detail}${cleanup}`, outcome.fix);
};

const awaitArrival = async (input: {
  tokens: { userToken: string };
  identity: SlackIdentity;
  sendTestMessage: boolean;
  deps: SlackTestDeps;
  arrival: Promise<number>;
  sent: { message: { channel: string; ts: string } | null };
  started: number;
}): Promise<Outcome> => {
  if (input.sendTestMessage) {
    const posted = await postTestMessage(
      input.tokens.userToken,
      input.identity.userId,
      input.deps.api,
    );
    if ("error" in posted) {
      return {
        ok: false,
        detail: `AOP could not send the test message (${posted.error})`,
        fix: posted.fix,
      };
    }
    input.sent.message = posted;
  }
  const waitMs = input.deps.waitMs ?? 60_000;
  const at = await Promise.race([input.arrival, Bun.sleep(waitMs).then(() => null)]);
  if (at === null) {
    return {
      ok: false,
      detail: `No message reached AOP in ${Math.round(waitMs / 1000)} s`,
      fix: NO_EVENTS_FIX,
    };
  }
  const seconds = ((at - input.started) / 1000).toFixed(1);
  return {
    ok: true,
    detail: `Events arrive: your ${input.sendTestMessage ? "test " : ""}message reached AOP in ${seconds} s`,
    fix: null,
  };
};

/**
 * Posts to the person's own DM. A user ID as the channel opens the DM with that user, here the
 * person themselves, so no `im:write` scope is needed; Slack answers with the DM's channel id.
 */
const postTestMessage = async (
  userToken: string,
  me: string,
  api: SlackWebApi,
): Promise<{ channel: string; ts: string } | { error: string; fix: string | null }> => {
  const posted = await api.call("chat.postMessage", userToken, { channel: me, text: TEST_MESSAGE });
  const error = slackError(posted);
  if (error) return { error, fix: scopeFix(error, "chat:write") };
  return { channel: text(posted.body.channel), ts: text(posted.body.ts) };
};

/** The test message goes as soon as the test is over, whether it arrived or not. */
const deleteTestMessage = async (
  userToken: string,
  sent: { channel: string; ts: string },
  api: SlackWebApi,
): Promise<string | null> => {
  const reply = await safeCall(api, "chat.delete", userToken, {
    channel: sent.channel,
    ts: sent.ts,
  });
  const error = slackError(reply);
  return error
    ? ` AOP could not delete its test message (${error}): delete "${TEST_MESSAGE}" in your own DM.`
    : "";
};

const scopeFix = (error: string, scope: string): string | null =>
  error === "missing_scope" ? `Add ${scope} under User Token Scopes and reinstall.` : null;

/** A call whose failure to reach Slack reads as Slack's own refusal, with the reason. */
export const safeCall = (
  api: SlackWebApi,
  method: string,
  token: string,
  params?: SlackParams,
): Promise<SlackReply> =>
  api.call(method, token, params).catch(
    (cause: unknown): SlackReply => ({
      body: { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      scopes: null,
    }),
  );

const safeJson = (data: unknown): unknown => {
  try {
    return JSON.parse(String(data));
  } catch {
    return null;
  }
};
