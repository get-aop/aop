import { mock } from "bun:test";
import type { UpdateStatus } from "@aop/common";

export const makeUpdateStatus = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  enabled: true,
  supported: true,
  current: "0.9.51",
  latest: "0.10.0",
  available: true,
  releaseUrl: "https://github.com/get-aop/aop-mono/releases/tag/v0.10.0",
  checkedAt: "2026-09-30T10:00:00.000Z",
  checkError: null,
  state: "idle",
  updateError: null,
  ...overrides,
});

export interface FakeHost {
  /** What `GET /api/health` reports; `null` makes the host unreachable, as during a restart. */
  health: { version: string } | null;
  status: UpdateStatus;
  owner: boolean;
  applyStatus: number;
  calls: string[];
}

/** Routes the dashboard's fetches to a scripted host and records `METHOD /path` for each. */
export const installFakeHost = (initial: Partial<FakeHost> = {}) => {
  const host: FakeHost = {
    health: { version: "0.9.51" },
    status: makeUpdateStatus(),
    owner: true,
    applyStatus: 202,
    calls: [],
    ...initial,
  };
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace(/^.*\/api/, "");
    host.calls.push(`${init?.method ?? "GET"} ${path}`);
    return answer(host, path);
  }) as unknown as typeof fetch;
  return host;
};

const answer = (host: FakeHost, path: string): Response | Promise<Response> => {
  if (path === "/health") return answerHealth(host);
  if (path === "/auth/me") return answerPrincipal(host);
  if (path === "/updates" || path === "/updates/check") return Response.json(host.status);
  if (path === "/updates/apply") return answerApply(host);
  return Response.json({});
};

const answerHealth = (host: FakeHost): Response | Promise<Response> =>
  host.health
    ? Response.json({ service: "aop", ...host.health })
    : Promise.reject(new TypeError("connection refused"));

const answerPrincipal = (host: FakeHost): Response =>
  Response.json(
    host.owner
      ? { kind: "owner" }
      : { kind: "device", device: { id: "d", name: "Laptop", createdAt: "", lastSeenAt: "" } },
  );

const answerApply = (host: FakeHost): Response =>
  host.applyStatus === 202
    ? Response.json({ ok: true }, { status: 202 })
    : Response.json({ error: "Nothing to update" }, { status: host.applyStatus });
