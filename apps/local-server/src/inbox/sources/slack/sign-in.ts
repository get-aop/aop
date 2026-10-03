import { createHash, randomBytes } from "node:crypto";
import {
  SLACK_OAUTH_CALLBACK_PATH,
  SLACK_USER_SCOPES,
  type SlackSignInInput,
  type SlackTokensInput,
} from "@aop/common";
import { safeCall } from "./connection-test.ts";
import { record, text } from "./directory.ts";
import { type SlackWebApi, slackError } from "./web-api.ts";

/**
 * Sign in with Slack, the private way: the person's own app has PKCE on, so the host signs them
 * in with no client secret and no server of AOP's in between. The host makes a one-time
 * `code_verifier`, sends the person to Slack's "Allow" page with its S256 challenge, and Slack
 * sends the browser back to the host's own callback with a code only that verifier can redeem.
 * https://docs.slack.dev/authentication/using-pkce/
 *
 * The `state` is the callback's whole authentication: random, single use, gone after ten minutes.
 */
export interface SlackSignIn {
  /** Checks the app-level token, then returns Slack's "Allow" page address. */
  begin: (input: SlackSignInInput) => Promise<{ authorizeUrl: string } | { error: string }>;
  /** Redeems the code Slack sent back; the tokens are the person's, ready to save. */
  finish: (query: {
    code?: string;
    state?: string;
    error?: string;
  }) => Promise<SlackTokensInput | { error: string }>;
}

const PENDING_MS = 10 * 60 * 1000;

interface Pending {
  verifier: string;
  clientId: string;
  appToken: string;
  redirectUrl: string;
  expiresAt: number;
}

export const createSlackSignIn = (deps: { api: SlackWebApi; now?: () => number }): SlackSignIn => {
  const now = deps.now ?? Date.now;
  const pending = new Map<string, Pending>();

  const take = (state: string | undefined): Pending | null => {
    if (!state) return null;
    const found = pending.get(state) ?? null;
    pending.delete(state);
    return found && found.expiresAt > now() ? found : null;
  };

  return {
    begin: async (input) => {
      if (new URL(input.redirectUrl).pathname !== SLACK_OAUTH_CALLBACK_PATH) {
        return {
          error: "The address Slack sends you back to must be this host's sign-in callback.",
        };
      }
      const socket = await safeCall(deps.api, "apps.connections.open", input.appToken);
      const socketError = slackError(socket);
      if (socketError) {
        return {
          error: `Slack refused the app-level token (${socketError}). Generate one under Basic Information › App-Level Tokens with the scope connections:write.`,
        };
      }
      for (const [state, entry] of pending) if (entry.expiresAt <= now()) pending.delete(state);
      const verifier = randomBytes(32).toString("base64url");
      const state = randomBytes(24).toString("base64url");
      pending.set(state, { ...input, verifier, expiresAt: now() + PENDING_MS });
      const url = new URL(slackAuthorizeUrl(deps.api.base));
      url.search = new URLSearchParams({
        client_id: input.clientId,
        user_scope: SLACK_USER_SCOPES.join(","),
        redirect_uri: input.redirectUrl,
        state,
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      return { authorizeUrl: url.toString() };
    },

    finish: async (query) => {
      const started = take(query.state);
      if (!started) {
        return { error: "This sign-in link has expired or was already used. Start again in AOP." };
      }
      if (query.error || !query.code) {
        return { error: `Slack did not sign you in (${query.error ?? "no code"}).` };
      }
      const reply = await safeCall(deps.api, "oauth.v2.access", "", {
        client_id: started.clientId,
        code: query.code,
        code_verifier: started.verifier,
        redirect_uri: started.redirectUrl,
      });
      const error = slackError(reply);
      if (error) return { error: `Slack refused the sign-in (${error}).` };
      const userToken = text(record(reply.body.authed_user).access_token);
      if (!userToken) return { error: "Slack signed you in but sent no user token." };
      return { userToken, appToken: started.appToken };
    },
  };
};

/** Slack's "Allow" page, beside the Web API (`AOP_SLACK_API_URL` moves both, for a fake Slack). */
export const slackAuthorizeUrl = (apiBase: string): string =>
  apiBase.replace(/\/api\/?$/, "/oauth/v2/authorize");
