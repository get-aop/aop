/**
 * Slack's Web API, called with the person's own tokens. `AOP_SLACK_API_URL` points the host at
 * another endpoint: verification runs and tests use a fake Slack.
 *
 * Rate limits: Slack answers a burst with 429 and `Retry-After` in seconds. A short wait is
 * waited out here; a longer one is thrown as SlackRateLimited, so a caller in the background
 * (catch-up) can wait and a caller in a request (reply) can say so.
 */

export const DEFAULT_SLACK_API_URL = "https://slack.com/api/";

export type SlackFetch = (url: string, init: RequestInit) => Promise<Response>;
export type SlackParams = Record<string, string | number | boolean | undefined>;

export interface SlackReply {
  /** The JSON body; `ok` is false with an `error` code when Slack refused. */
  body: Record<string, unknown>;
  /** The token's granted scopes (`x-oauth-scopes`), when Slack sent them. */
  scopes: string[] | null;
}

export interface SlackWebApi {
  /** The Web API's base address, ending in `/`. */
  base: string;
  call: (method: string, token: string, params?: SlackParams) => Promise<SlackReply>;
}

export class SlackRateLimited extends Error {
  constructor(
    readonly method: string,
    readonly retryAfterMs: number,
  ) {
    super(`Slack asked to slow down for ${Math.ceil(retryAfterMs / 1000)}s (${method})`);
  }
}

export class SlackUnreachable extends Error {}

export interface SlackWebApiOptions {
  url?: string;
  fetch?: SlackFetch;
  sleep?: (ms: number) => Promise<void>;
  /** Waits up to this long by itself when Slack asks to slow down. */
  maxWaitMs?: number;
}

const DEFAULT_MAX_WAIT_MS = 15_000;
const MAX_ATTEMPTS = 3;

export const slackApiUrl = (): string =>
  process.env.AOP_SLACK_API_URL?.trim() || DEFAULT_SLACK_API_URL;

export const createSlackWebApi = (options: SlackWebApiOptions = {}): SlackWebApi => {
  const base = withSlash(options.url ?? slackApiUrl());
  const fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => Bun.sleep(ms));
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  const send = async (method: string, token: string, params: SlackParams): Promise<Response> => {
    try {
      return await fetchImpl(`${base}${method}`, {
        method: "POST",
        // oauth.v2.access authenticates with its code and verifier, not a token.
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formOf(params),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (cause) {
      throw new SlackUnreachable(
        `Could not reach Slack (${method}): ${cause instanceof Error ? cause.message : cause}`,
      );
    }
  };

  const call = async (
    method: string,
    token: string,
    params: SlackParams = {},
    attempt = 1,
  ): Promise<SlackReply> => {
    const response = await send(method, token, params);
    if (response.status !== 429) return readReply(method, response);
    const waitMs = retryAfterMs(response);
    if (waitMs > maxWaitMs || attempt >= MAX_ATTEMPTS) throw new SlackRateLimited(method, waitMs);
    await sleep(waitMs);
    return call(method, token, params, attempt + 1);
  };

  return { base, call: (method, token, params) => call(method, token, params) };
};

/** The error code of a refused call, or null when it went through. */
export const slackError = (reply: SlackReply): string | null =>
  reply.body.ok === true ? null : String(reply.body.error ?? "unknown_error");

/** Errors that mean the token itself is gone: only new tokens help. */
export const REVOKED_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "no_permission",
]);

const readReply = async (method: string, response: Response): Promise<SlackReply> => {
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new SlackUnreachable(`Slack answered ${method} with ${response.status}`);
  const header = response.headers.get("x-oauth-scopes");
  return {
    body,
    scopes: header === null ? null : header.split(",").map((scope) => scope.trim()),
  };
};

const formOf = (params: SlackParams): URLSearchParams => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.set(key, String(value));
  }
  return form;
};

const retryAfterMs = (response: Response): number => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
};

const withSlash = (url: string): string => (url.endsWith("/") ? url : `${url}/`);
