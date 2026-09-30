import { API_VERSION, MIN_CLIENT_API_VERSION } from "@aop/common";
import type { FetchLike, HostClient } from "./host-client";

export const HOST = "https://mac.tail1234.ts.net";

export const healthyBody = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  service: "aop",
  version: "0.9.51",
  apiVersion: API_VERSION,
  minClientApiVersion: MIN_CLIENT_API_VERSION,
  uptime: 10,
  db: { connected: true },
  ...overrides,
});

export const fakeDevice = () => ({
  id: "dev_1",
  name: "Work laptop",
  createdAt: "2026-09-30T10:00:00.000Z",
  lastSeenAt: null,
});

/** A host client that answers like a healthy host that already knows this device. */
export const fakeHostClient = (overrides: Partial<HostClient> = {}): HostClient => ({
  health: async () => ({
    status: "ok",
    health: {
      service: "aop",
      version: "0.9.51",
      apiVersion: API_VERSION,
      minClientApiVersion: MIN_CLIENT_API_VERSION,
    },
  }),
  principal: async () => ({
    status: "ok",
    principal: { kind: "device", device: fakeDevice() },
  }),
  pair: async () => ({ status: "paired", token: "aop_new_token" }),
  createPairingCode: async () => ({
    status: "ok",
    code: "K7QM-4XNP",
    expiresAt: "2026-09-30T12:00:00.000Z",
  }),
  signOut: async () => {},
  ...overrides,
});

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  credentials: RequestCredentials | undefined;
}

/** A fetch that answers from a script and remembers what it was asked. */
export const scriptedFetch = (
  answer: (request: RecordedRequest) => Response | Promise<Response>,
): { fetch: FetchLike; requests: RecordedRequest[] } => {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    fetch: async (input, init) => {
      const request: RecordedRequest = {
        url: input,
        method: init?.method ?? "GET",
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: typeof init?.body === "string" ? init.body : null,
        credentials: init?.credentials,
      };
      requests.push(request);
      return answer(request);
    },
  };
};

/** A clock the test winds by hand: `schedule` queues, `fire` runs what is due. */
export const createManualScheduler = () => {
  const pending: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  return {
    schedule: (run: () => void, delayMs: number) => {
      const timer = { run, delayMs, cancelled: false };
      pending.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    /** Delays of the timers that are still waiting. */
    waiting: () => pending.filter((timer) => !timer.cancelled).map((timer) => timer.delayMs),
    fire: () => {
      for (const timer of pending.splice(0)) if (!timer.cancelled) timer.run();
    },
  };
};

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
