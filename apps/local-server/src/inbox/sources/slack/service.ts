import type {
  InboxItem,
  InboxNotifyMode,
  SlackConnection,
  SlackSignInInput,
  SlackTestInput,
  SlackTestReport,
  SlackTokensInput,
} from "@aop/common";
import { SLACK_USER_SCOPES } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { IncomingMessage } from "../../matcher.ts";
import type { InboxService } from "../../service.ts";
import type { InboxSourceRepository } from "../../source-repository.ts";
import {
  createSlackConnectionStore,
  type SlackConnectionStore,
  type StoredSlackConnection,
  slackSourceId,
} from "./connection-store.ts";
import { readIdentity, runSlackTest, safeCall } from "./connection-test.ts";
import { record, text } from "./directory.ts";
import { type SlackFeed, startSlackFeed } from "./feed.ts";
import { createSlackSignIn } from "./sign-in.ts";
import type { WebSocketLike } from "./socket.ts";
import { readSpikeTokens, removeSpike, spikeDir } from "./spike-import.ts";
import { createSlackWebApi, type SlackWebApi, slackError } from "./web-api.ts";

/**
 * The host's Slack connection: the saved workspace, its live feed, and the setup's test. One
 * workspace for now (the data is keyed by `slack:<team id>`, so a second one is a UI away).
 * Tokens can be saved or replaced from any client, never read back (decision D3).
 */
export type SlackServiceError =
  | { code: "NOT_CONNECTED" }
  | { code: "INVALID_TOKENS"; message: string }
  | { code: "NO_IMPORT" };
export type SlackResult<T> = ({ success: true } & T) | { success: false; error: SlackServiceError };

export interface SlackService {
  /** Starts the feed of the saved workspace, if there is one. */
  start: () => Promise<void>;
  stop: () => void;
  connection: () => Promise<SlackConnection | null>;
  importAvailable: () => Promise<boolean>;
  test: (input: SlackTestInput) => Promise<SlackResult<{ report: SlackTestReport }>>;
  connect: (tokens: SlackTokensInput) => Promise<SlackResult<{ connection: SlackConnection }>>;
  /** Sign in with Slack (PKCE): Slack's "Allow" page for the person's own app. */
  beginSignIn: (input: SlackSignInInput) => Promise<{ authorizeUrl: string } | { error: string }>;
  /** Slack sent the person back: redeem the code and connect. */
  finishSignIn: (query: {
    code?: string;
    state?: string;
    error?: string;
  }) => Promise<SlackResult<{ connection: SlackConnection }>>;
  /** Saves the tokens the design's first test left on the host, then deletes its folder. */
  importSpike: () => Promise<SlackResult<{ connection: SlackConnection }>>;
  disconnect: (deleteMessages: boolean) => Promise<void>;
  setNotifications: (
    mode: InboxNotifyMode,
  ) => Promise<SlackResult<{ connection: SlackConnection }>>;
  /** The live feed of an item's workspace, for reading and replying. */
  feedFor: (sourceId: string) => SlackFeed | null;
  api: SlackWebApi;
}

export interface SlackServiceDeps {
  inbox: InboxService;
  sources: InboxSourceRepository;
  store?: SlackConnectionStore;
  api?: SlackWebApi;
  spikeDir?: string;
  onNewItem?: (item: InboxItem, message: IncomingMessage) => void;
  createSocket?: (url: string) => WebSocketLike;
  testWaitMs?: number;
  catchUpPauseMs?: number;
  now?: () => number;
}

const logger = getLogger("inbox", "slack");

export const createSlackService = (deps: SlackServiceDeps): SlackService => {
  const store = deps.store ?? createSlackConnectionStore();
  const api = deps.api ?? createSlackWebApi();
  const spike = deps.spikeDir ?? spikeDir();
  const feeds = new Map<string, SlackFeed>();

  const run = (connection: StoredSlackConnection): void => {
    feeds.get(connection.teamId)?.stop();
    feeds.set(
      connection.teamId,
      startSlackFeed({
        connection,
        api,
        inbox: deps.inbox,
        sources: deps.sources,
        onNewItem: deps.onNewItem,
        createSocket: deps.createSocket,
        catchUpPauseMs: deps.catchUpPauseMs,
        now: deps.now,
      }),
    );
  };

  const describe = async (connection: StoredSlackConnection): Promise<SlackConnection> => {
    const sourceId = slackSourceId(connection.teamId);
    const status = feeds.get(connection.teamId)?.status() ?? {
      health: "offline" as const,
      lastEventAt: null,
      problem: "Not listening",
    };
    return {
      sourceId,
      teamId: connection.teamId,
      teamName: connection.teamName,
      teamUrl: connection.teamUrl,
      userId: connection.userId,
      userName: connection.userName,
      connectedAt: connection.connectedAt,
      health: status.health,
      lastEventAt: status.lastEventAt,
      problem: status.problem,
      missingScopes: SLACK_USER_SCOPES.filter((scope) => !connection.scopes.includes(scope)),
      notifications: await deps.sources.notifications(sourceId),
    };
  };

  const current = async (): Promise<StoredSlackConnection | null> =>
    (await store.list())[0] ?? null;

  const connect = async (
    tokens: SlackTokensInput,
  ): Promise<SlackResult<{ connection: SlackConnection }>> => {
    const verified = await verify(tokens, api);
    if ("error" in verified) {
      return { success: false, error: { code: "INVALID_TOKENS", message: verified.error } };
    }
    // One workspace for now: connecting another one replaces it (its messages stay).
    for (const other of await store.list()) {
      if (other.teamId === verified.teamId) continue;
      feeds.get(other.teamId)?.stop();
      feeds.delete(other.teamId);
      await store.remove(other.teamId);
    }
    await store.write(verified.teamId, verified);
    run(verified);
    logger.info("Slack connected: {team} as {user}", {
      team: verified.teamName,
      user: verified.userName,
    });
    return { success: true, connection: await describe(verified) };
  };

  const signIn = createSlackSignIn({ api });

  return {
    api,
    beginSignIn: (input) => signIn.begin(input),
    finishSignIn: async (query) => {
      const tokens = await signIn.finish(query);
      if ("error" in tokens) {
        return { success: false, error: { code: "INVALID_TOKENS", message: tokens.error } };
      }
      return connect(tokens);
    },
    start: async () => {
      for (const connection of await store.list()) run(connection);
    },
    stop: () => {
      for (const feed of feeds.values()) feed.stop();
      feeds.clear();
    },
    connection: async () => {
      const connection = await current();
      return connection ? describe(connection) : null;
    },
    importAvailable: async () => (await readSpikeTokens(spike)) !== null,
    test: async (input) => {
      const saved = await current();
      const userToken = input.userToken ?? saved?.userToken;
      const appToken = input.appToken ?? saved?.appToken;
      if (!userToken || !appToken) return { success: false, error: { code: "NOT_CONNECTED" } };
      const { report } = await runSlackTest({ userToken, appToken }, input.sendTestMessage, {
        api,
        createSocket: deps.createSocket,
        tapFeed: (teamId, listener) => feeds.get(teamId)?.tap(listener) ?? (() => undefined),
        waitMs: deps.testWaitMs,
      });
      return { success: true, report };
    },
    connect,
    importSpike: async () => {
      const tokens = await readSpikeTokens(spike);
      if (!tokens) return { success: false, error: { code: "NO_IMPORT" } };
      const result = await connect(tokens);
      if (result.success) await removeSpike(spike);
      return result;
    },
    disconnect: async (deleteMessages) => {
      for (const connection of await store.list()) {
        feeds.get(connection.teamId)?.stop();
        feeds.delete(connection.teamId);
        await store.remove(connection.teamId);
        if (deleteMessages) await deps.sources.removeSource(slackSourceId(connection.teamId));
      }
    },
    setNotifications: async (mode) => {
      const connection = await current();
      if (!connection) return { success: false, error: { code: "NOT_CONNECTED" } };
      await deps.sources.setNotifications(slackSourceId(connection.teamId), mode);
      return { success: true, connection: await describe(connection) };
    },
    feedFor: (sourceId) =>
      [...feeds.values()].find((feed) => slackSourceId(feed.connection.teamId) === sourceId) ??
      null,
  };
};

/**
 * Checks the two tokens before they are saved: who the user token is, and that the app token
 * opens Socket Mode. The event round trip is the test's: saving does not wait a minute.
 */
const verify = async (
  tokens: SlackTokensInput,
  api: SlackWebApi,
): Promise<StoredSlackConnection | { error: string }> => {
  if (!tokens.userToken.startsWith("xoxp-")) {
    return { error: "The user token must be the User OAuth Token, which starts with xoxp-." };
  }
  if (!tokens.appToken.startsWith("xapp-")) {
    return { error: "The app-level token starts with xapp-." };
  }
  const identity = await readIdentity(tokens.userToken, api).catch((cause: Error) => ({
    error: cause.message,
  }));
  if ("error" in identity) return { error: `Slack refused the user token (${identity.error}).` };
  const socket = await safeCall(api, "apps.connections.open", tokens.appToken);
  const socketError = slackError(socket);
  if (socketError) return { error: `Slack refused the app-level token (${socketError}).` };
  return {
    ...identity,
    userName: await displayName(api, tokens.userToken, identity.userId, identity.userName),
    userToken: tokens.userToken,
    appToken: tokens.appToken,
    connectedAt: new Date().toISOString(),
  };
};

const displayName = async (
  api: SlackWebApi,
  token: string,
  userId: string,
  fallback: string,
): Promise<string> => {
  const reply = await api.call("users.info", token, { user: userId }).catch(() => null);
  const profile = record(record(reply?.body.user).profile);
  return text(profile.display_name) || text(profile.real_name) || fallback;
};
