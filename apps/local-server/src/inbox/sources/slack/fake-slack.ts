import type { ServerWebSocket } from "bun";

/**
 * A fake Slack for tests and verification runs: the Web API methods the host calls and a Socket
 * Mode WebSocket, over one workspace with people, channels, groups and messages. Point the host
 * at it with `AOP_SLACK_API_URL=<url>` (see `.claude/skills/verify/scripts/fake-slack.ts`).
 *
 * `say`, `edit` and `remove` act as other people do in Slack: the message is stored, so
 * history and replies read it, and the event goes to the newest open socket, as Slack hands each
 * event to one of an app's connections. With events off, a socket still gets its hello and
 * nothing else: Slack with Socket Mode off in the app's settings.
 */
export const FAKE_SLACK_TOKENS = {
  user: "xoxp-fake-user",
  app: "xapp-fake-app",
  /** The app's Client ID, for signing in with PKCE. */
  clientId: "1111111111.2222222222",
} as const;

export interface FakeMessage {
  ts: string;
  user: string;
  text: string;
  thread_ts?: string;
  subtype?: string;
  reply_count?: number;
  latest_reply?: string;
}

interface FakeChannel {
  id: string;
  name: string;
  kind: "public" | "private" | "im" | "mpim";
  /** The other person, for a DM. */
  user?: string;
}

export interface FakeSlackOptions {
  port?: number;
  scopes?: readonly string[];
  /** Socket Mode on in the app's settings; off, sockets connect and say hello but get no events. */
  events?: boolean;
  /** The clock message timestamps follow; a test that moves time passes the feed's own. */
  now?: () => number;
}

export interface FakeSlack {
  /** The Web API's base, for `AOP_SLACK_API_URL`. */
  apiUrl: string;
  origin: string;
  me: string;
  say: (input: { channel: string; user: string; text: string; threadTs?: string }) => FakeMessage;
  edit: (channel: string, ts: string, text: string) => void;
  remove: (channel: string, ts: string) => void;
  setEvents: (on: boolean) => void;
  /** Sends Slack's refresh warning on every socket, then closes them. */
  refresh: () => void;
  /** Closes every socket without warning (a network drop). */
  drop: () => void;
  /** Refuses the next call of a method once, with a Slack error or a 429 and its wait. */
  failNext: (method: string, failure: { error: string } | { retryAfter: number }) => void;
  /** Holds the next call of a method unanswered until released (`reached` once it arrives). */
  holdNext: (method: string) => { reached: Promise<void>; release: () => void };
  calls: Array<{ method: string; params: Record<string, string> }>;
  posted: FakeMessage[];
  deleted: string[];
  messages: (channel: string) => FakeMessage[];
  sockets: () => number;
  stop: () => void;
}

const ME = "U0ME";
const PEOPLE: Record<string, { name: string; real: string }> = {
  U0ME: { name: "marcelo", real: "Marcelo" },
  U0PRIYA: { name: "priya", real: "Priya Rao" },
  U0JONAS: { name: "jonas", real: "Jonas Lind" },
  U0ANA: { name: "ana", real: "Ana Kovač" },
  U0MEI: { name: "mei", real: "Mei Lin" },
  U0SAM: { name: "sam", real: "Sam Ortiz" },
};
const CHANNELS: FakeChannel[] = [
  { id: "C0INFRA", name: "infra", kind: "public" },
  { id: "C0ANNOUNCE", name: "eng-announce", kind: "public" },
  { id: "C0PLATFORM", name: "platform", kind: "public" },
  { id: "C0DESIGN", name: "design", kind: "public" },
  { id: "C0RANDOM", name: "random", kind: "public" },
  { id: "G0OPS", name: "ops", kind: "private" },
  { id: "D0JONAS", name: "jonas", kind: "im", user: "U0JONAS" },
  { id: "D0SELF", name: "marcelo", kind: "im", user: ME },
  { id: "G0MPIM", name: "mpdm-ana--jonas--marcelo-1", kind: "mpim" },
];
const GROUPS = [
  { id: "S0PLATFORM", handle: "platform-team", users: [ME, "U0MEI"] },
  { id: "S0ONCALL", handle: "oncall", users: ["U0SAM"] },
];
const ALL_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
  "usergroups:read",
  "dnd:read",
  "team:read",
  "chat:write",
];

export const startFakeSlack = (options: FakeSlackOptions = {}): FakeSlack => {
  const state = new FakeState(options);
  const server = Bun.serve<{ id: number }>({
    port: options.port ?? 0,
    hostname: "127.0.0.1",
    fetch: (request, bun) => state.fetch(request, bun),
    websocket: {
      open: (socket) => state.opened(socket),
      message: () => undefined,
      close: (socket) => {
        state.sockets.delete(socket);
      },
    },
  });
  state.origin = `http://127.0.0.1:${server.port}`;
  return {
    apiUrl: `${state.origin}/api/`,
    origin: state.origin,
    me: ME,
    say: (input) => state.say(input),
    edit: (channel, ts, text) => state.edit(channel, ts, text),
    remove: (channel, ts) => state.remove(channel, ts),
    setEvents: (on) => {
      state.events = on;
    },
    refresh: () => state.refresh(),
    drop: () => {
      for (const socket of state.sockets) socket.close();
    },
    failNext: (method, failure) => state.failures.set(method, failure),
    holdNext: (method) => state.holdNext(method),
    calls: state.calls,
    posted: state.posted,
    deleted: state.deleted,
    messages: (channel) => state.history.get(channel) ?? [],
    sockets: () => state.sockets.size,
    stop: () => server.stop(true),
  };
};

type Params = Record<string, string>;
type Reply = Record<string, unknown>;

class FakeState {
  origin = "";
  events: boolean;
  readonly sockets = new Set<ServerWebSocket<{ id: number }>>();
  readonly history = new Map<string, FakeMessage[]>();
  readonly calls: Array<{ method: string; params: Params }> = [];
  readonly posted: FakeMessage[] = [];
  readonly deleted: string[] = [];
  /** Codes Slack's "Allow" page gave out, with the PKCE challenge each must answer. */
  private readonly codes = new Map<string, { challenge: string; redirect: string }>();
  readonly failures = new Map<string, { error: string } | { retryAfter: number }>();
  private readonly holds = new Map<string, { arrived: () => void; released: Promise<void> }>();
  private micros = 0;
  private sequence = 0;
  private envelopes = 0;
  private readonly scopes: readonly string[];
  private readonly now: () => number;

  constructor(options: FakeSlackOptions) {
    this.events = options.events ?? true;
    this.scopes = options.scopes ?? ALL_SCOPES;
    this.now = options.now ?? Date.now;
  }

  async fetch(request: Request, bun: Bun.Server<{ id: number }>): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.pathname === "/socket") {
      return bun.upgrade(request, { data: { id: this.sequence } })
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    }
    if (url.pathname.startsWith("/api/")) {
      return this.api(url.pathname.slice("/api/".length), request);
    }
    if (url.pathname === "/oauth/v2/authorize") return this.authorize(url);
    // "Open in Slack" lands here in a verification run.
    return new Response(`<h1>Fake Slack</h1><p>${url.pathname}${url.search}</p>`, {
      headers: { "content-type": "text/html" },
    });
  }

  opened(socket: ServerWebSocket<{ id: number }>): void {
    this.sockets.add(socket);
    socket.send(
      JSON.stringify({ type: "hello", num_connections: this.sockets.size, debug_info: {} }),
    );
  }

  say(input: { channel: string; user: string; text: string; threadTs?: string }): FakeMessage {
    const message: FakeMessage = { ts: this.nextTs(), user: input.user, text: input.text };
    if (input.threadTs) {
      message.thread_ts = input.threadTs;
      const parent = this.find(input.channel, input.threadTs);
      if (parent) {
        parent.thread_ts = parent.ts;
        parent.reply_count = (parent.reply_count ?? 0) + 1;
        parent.latest_reply = message.ts;
      }
    }
    this.store(input.channel, message);
    this.emit({
      type: "message",
      channel: input.channel,
      channel_type: this.channelType(input.channel),
      ...message,
    });
    return message;
  }

  edit(channel: string, ts: string, text: string): void {
    const message = this.find(channel, ts);
    if (!message) return;
    message.text = text;
    this.emit({
      type: "message",
      subtype: "message_changed",
      channel,
      ts: this.nextTs(),
      message: { ...message, edited: { user: message.user, ts: this.nextTs() } },
    });
  }

  remove(channel: string, ts: string): void {
    this.history.set(
      channel,
      (this.history.get(channel) ?? []).filter((message) => message.ts !== ts),
    );
    this.emit({
      type: "message",
      subtype: "message_deleted",
      channel,
      deleted_ts: ts,
      ts: this.nextTs(),
    });
  }

  holdNext(method: string): { reached: Promise<void>; release: () => void } {
    const reached = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    this.holds.set(method, { arrived: reached.resolve, released: released.promise });
    return { reached: reached.promise, release: released.resolve };
  }

  refresh(): void {
    for (const socket of this.sockets) {
      socket.send(JSON.stringify({ type: "disconnect", reason: "refresh_requested" }));
      socket.close();
    }
  }

  /** Slack's "Allow" page: Allow sends the browser back with a code, Cancel with an error. */
  private authorize(url: URL): Response {
    const params = url.searchParams;
    const redirect = params.get("redirect_uri") ?? "";
    const state = params.get("state") ?? "";
    if (
      params.get("client_id") !== FAKE_SLACK_TOKENS.clientId ||
      params.get("code_challenge_method") !== "S256"
    ) {
      return new Response("<h1>Fake Slack: invalid_client or no PKCE</h1>", {
        status: 400,
        headers: { "content-type": "text/html" },
      });
    }
    const code = `code-${++this.sequence}`;
    this.codes.set(code, { challenge: params.get("code_challenge") ?? "", redirect });
    const back = (query: string) => `${redirect}?${query}&state=${encodeURIComponent(state)}`;
    return new Response(
      `<!doctype html><title>Fake Slack</title><h1>AOP Inbox wants to access Acme</h1>
<p>Scopes: ${params.get("user_scope")}</p>
<p><a data-testid="fake-slack-allow" href="${back(`code=${code}`)}">Allow</a>
 · <a data-testid="fake-slack-cancel" href="${back("error=access_denied")}">Cancel</a></p>`,
      { headers: { "content-type": "text/html" } },
    );
  }

  private exchange(params: Params): Reply {
    const issued = this.codes.get(params.code ?? "");
    this.codes.delete(params.code ?? "");
    if (!issued || params.client_id !== FAKE_SLACK_TOKENS.clientId) {
      return { ok: false, error: "invalid_code" };
    }
    const challenge = new Bun.CryptoHasher("sha256")
      .update(params.code_verifier ?? "")
      .digest("base64url");
    if (challenge !== issued.challenge) return { ok: false, error: "invalid_code_verifier" };
    if (params.redirect_uri !== issued.redirect) return { ok: false, error: "bad_redirect_uri" };
    return {
      ok: true,
      app_id: "A0FAKE",
      authed_user: {
        id: ME,
        scope: this.scopes.join(","),
        access_token: FAKE_SLACK_TOKENS.user,
        token_type: "user",
      },
      team: { id: "T0FAKE", name: "Acme" },
    };
  }

  private async api(method: string, request: Request): Promise<Response> {
    const params = Object.fromEntries(new URLSearchParams(await request.text())) as Params;
    this.calls.push({ method, params });
    const hold = this.holds.get(method);
    if (hold) {
      this.holds.delete(method);
      hold.arrived();
      await hold.released;
    }
    const failure = this.failures.get(method);
    if (failure) {
      this.failures.delete(method);
      if ("retryAfter" in failure) {
        return Response.json(
          { ok: false, error: "ratelimited" },
          { status: 429, headers: { "retry-after": String(failure.retryAfter) } },
        );
      }
      return Response.json({ ok: false, error: failure.error });
    }
    if (method === "oauth.v2.access") return Response.json(this.exchange(params));
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const expected =
      method === "apps.connections.open" ? FAKE_SLACK_TOKENS.app : FAKE_SLACK_TOKENS.user;
    if (token !== expected) return Response.json({ ok: false, error: "invalid_auth" });
    const handler = this.handlers[method];
    const body = handler ? handler(params) : { ok: false, error: "unknown_method" };
    return Response.json(body, { headers: { "x-oauth-scopes": this.scopes.join(",") } });
  }

  private readonly handlers: Record<string, (params: Params) => Reply> = {
    "auth.test": () => ({
      ok: true,
      url: `${this.origin}/`,
      team: "Acme",
      team_id: "T0FAKE",
      user: "marcelo",
      user_id: ME,
    }),
    "apps.connections.open": () => ({
      ok: true,
      url: `${this.origin.replace("http", "ws")}/socket?ticket=${++this.sequence}`,
    }),
    "users.info": (params) => {
      const person = PEOPLE[params.user ?? ""];
      if (!person) return { ok: false, error: "user_not_found" };
      return {
        ok: true,
        user: {
          id: params.user,
          name: person.name,
          profile: { real_name: person.real, display_name: person.real },
        },
      };
    },
    "conversations.info": (params) => {
      const channel = CHANNELS.find((candidate) => candidate.id === params.channel);
      return channel
        ? { ok: true, channel: channelObject(channel) }
        : { ok: false, error: "channel_not_found" };
    },
    "users.conversations": (params) => {
      const types = (params.types ?? "public_channel").split(",");
      const wanted = CHANNELS.filter((channel) => types.includes(TYPE_NAMES[channel.kind]));
      return {
        ok: true,
        channels: wanted.map(channelObject),
        response_metadata: { next_cursor: "" },
      };
    },
    "conversations.history": (params) => {
      const all = this.history.get(params.channel ?? "") ?? [];
      const top = all.filter((message) => !message.thread_ts || message.thread_ts === message.ts);
      const latest = params.latest ?? "9999999999";
      const inclusive = params.inclusive === "true";
      const shown = top
        .filter((message) => message.ts > (params.oldest ?? "0"))
        .filter((message) => (inclusive ? message.ts <= latest : message.ts < latest))
        .reverse()
        .slice(0, Number(params.limit ?? 100));
      return { ok: true, messages: shown, has_more: false };
    },
    "conversations.replies": (params) => {
      const all = this.history.get(params.channel ?? "") ?? [];
      const thread = all.filter(
        (message) => message.ts === params.ts || message.thread_ts === params.ts,
      );
      return { ok: true, messages: thread, has_more: false };
    },
    "usergroups.list": () => ({ ok: true, usergroups: GROUPS.map((group) => ({ ...group })) }),
    "chat.postMessage": (params) => this.postAsMe(params),
    "chat.delete": (params) => {
      this.deleted.push(params.ts ?? "");
      this.remove(params.channel ?? "", params.ts ?? "");
      return { ok: true, channel: params.channel, ts: params.ts };
    },
    "users.getPresence": () => ({ ok: true, presence: "away" }),
    "dnd.info": () => ({ ok: true, dnd_enabled: false, snooze_enabled: false }),
    "team.info": () => ({ ok: true, team: { id: "T0FAKE", name: "Acme" } }),
  };

  private postAsMe(params: Params): Reply {
    const channel = params.channel === ME ? "D0SELF" : (params.channel ?? "");
    if (!CHANNELS.some((candidate) => candidate.id === channel)) {
      return { ok: false, error: "channel_not_found" };
    }
    const message = this.say({
      channel,
      user: ME,
      text: params.text ?? "",
      threadTs: params.thread_ts,
    });
    this.posted.push(message);
    return { ok: true, channel, ts: message.ts, message };
  }

  private emit(event: Reply): void {
    if (!this.events) return;
    const newest = [...this.sockets].at(-1);
    newest?.send(
      JSON.stringify({
        envelope_id: `env-${++this.envelopes}`,
        type: "events_api",
        accepts_response_payload: false,
        payload: {
          team_id: "T0FAKE",
          event,
          authorizations: [{ team_id: "T0FAKE", user_id: ME, is_bot: false }],
        },
      }),
    );
  }

  private store(channel: string, message: FakeMessage): void {
    this.history.set(channel, [...(this.history.get(channel) ?? []), message]);
  }

  private find(channel: string, ts: string): FakeMessage | undefined {
    return this.history.get(channel)?.find((message) => message.ts === ts);
  }

  private channelType(channel: string): string {
    const kind = CHANNELS.find((candidate) => candidate.id === channel)?.kind ?? "public";
    return { public: "channel", private: "group", im: "im", mpim: "mpim" }[kind];
  }

  // Slack's ts: the time in seconds to the microsecond, always increasing.
  private nextTs(): string {
    this.micros = Math.max(this.micros + 1, this.now() * 1000);
    return `${Math.floor(this.micros / 1e6)}.${String(this.micros % 1e6).padStart(6, "0")}`;
  }
}

const TYPE_NAMES = { public: "public_channel", private: "private_channel", im: "im", mpim: "mpim" };

const channelObject = (channel: FakeChannel) => ({
  id: channel.id,
  name: channel.name,
  is_channel: channel.kind === "public",
  is_private: channel.kind === "private" || channel.kind === "mpim",
  is_im: channel.kind === "im",
  is_mpim: channel.kind === "mpim",
  is_member: true,
  ...(channel.user ? { user: channel.user } : {}),
  ...(channel.kind === "mpim"
    ? { purpose: { value: "Group messaging with: @ana @jonas @marcelo" } }
    : {}),
});
