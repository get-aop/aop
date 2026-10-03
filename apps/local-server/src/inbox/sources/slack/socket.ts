/**
 * A Socket Mode connection: the host asks Slack for a WebSocket URL with the app-level token
 * (`apps.connections.open`) and keeps an outbound socket open, so it works on a host no one can
 * reach from the internet. Every envelope is acked by its id at once, or Slack sends it again.
 * https://docs.slack.dev/apis/events-api/using-socket-mode
 *
 * Slack refreshes a connection every few hours, warning with a `disconnect` envelope first; the
 * client then opens the next socket before the old one goes. A dropped socket is opened again
 * with growing waits (1 s up to a minute, with jitter), so a Slack outage is not hammered.
 */

export type SocketState = "connecting" | "connected" | "offline";

export interface SocketModeDeps {
  /** apps.connections.open: a fresh `wss://` URL, or an error code from Slack. */
  openUrl: () => Promise<{ url: string } | { error: string }>;
  onEvent: (payload: unknown) => void;
  onState: (state: SocketState, detail?: string) => void;
  /** Slack refused the token: the client stops, since only new tokens help. */
  onFatal: (error: string) => void;
  isFatal: (error: string) => boolean;
  createSocket?: (url: string) => WebSocketLike;
  schedule?: (run: () => void, ms: number) => () => void;
  random?: () => number;
}

export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
}

export interface SocketModeClient {
  stop: () => void;
}

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

export const startSocketMode = (deps: SocketModeDeps): SocketModeClient => {
  const client = new SocketModeConnection(deps);
  void client.connect();
  return { stop: () => client.stop() };
};

type Opened = { url: string } | { error: string };

class SocketModeConnection {
  private stopped = false;
  private failures = 0;
  private current: WebSocketLike | null = null;
  private cancelRetry: (() => void) | null = null;
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly schedule: (run: () => void, ms: number) => () => void;

  constructor(private readonly deps: SocketModeDeps) {
    this.createSocket = deps.createSocket ?? ((url) => new WebSocket(url) as WebSocketLike);
    this.schedule = deps.schedule ?? defaultSchedule;
  }

  async connect(): Promise<void> {
    if (this.stopped) return;
    this.deps.onState("connecting");
    const opened = await this.open();
    if (this.stopped) return;
    if (!("error" in opened)) {
      this.listen(this.createSocket(opened.url));
    } else if (this.deps.isFatal(opened.error)) {
      this.stopped = true;
      this.deps.onFatal(opened.error);
    } else {
      this.retry(opened.error);
    }
  }

  stop(): void {
    this.stopped = true;
    this.cancelRetry?.();
    this.current?.close();
    this.current = null;
  }

  private async open(): Promise<Opened> {
    try {
      return await this.deps.openUrl();
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  private retry(detail: string): void {
    if (this.stopped) return;
    this.deps.onState("offline", detail);
    const base = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 60_000;
    this.failures += 1;
    const random = this.deps.random ?? Math.random;
    const delay = Math.round(base * (0.8 + random() * 0.4));
    this.cancelRetry = this.schedule(() => void this.connect(), delay);
  }

  private listen(socket: WebSocketLike): void {
    const state = { refreshing: false };
    socket.onmessage = (frame) => {
      const envelope = parse(frame.data);
      if (envelope) this.receive(socket, envelope, state);
    };
    socket.onclose = () => {
      if (this.current === socket) this.current = null;
      if (!state.refreshing && !this.current) this.retry("The connection to Slack closed");
    };
    socket.onerror = () => undefined;
  }

  private receive(
    socket: WebSocketLike,
    envelope: Record<string, unknown>,
    state: { refreshing: boolean },
  ): void {
    if (typeof envelope.envelope_id === "string") {
      socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
    }
    if (envelope.type === "hello") this.connected(socket);
    else if (envelope.type === "events_api") this.deps.onEvent(envelope.payload);
    else if (envelope.type === "disconnect" && !state.refreshing) {
      // Slack is about to close this socket: the next one opens first, so nothing is missed.
      state.refreshing = true;
      void this.connect();
    }
  }

  private connected(socket: WebSocketLike): void {
    this.failures = 0;
    const previous = this.current;
    this.current = socket;
    if (previous && previous !== socket) previous.close();
    this.deps.onState("connected");
  }
}

const defaultSchedule = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

const parse = (data: unknown): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(String(data));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
