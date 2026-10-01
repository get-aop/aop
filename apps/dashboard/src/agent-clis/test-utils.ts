import { mock } from "bun:test";
import type { AgentCliStatus, AgentClisResponse } from "@aop/common";

export const makeCli = (overrides: Partial<AgentCliStatus> = {}): AgentCliStatus => ({
  provider: "claude-code",
  label: "Claude Code",
  command: "claude",
  installed: true,
  path: "/Users/me/.local/bin/claude",
  realPath: "/Users/me/.local/share/claude/versions/2.1.285",
  version: "2.1.285",
  installMethod: "native",
  updateCommand: "claude update",
  latest: "2.1.286",
  channel: "latest",
  updateAvailable: true,
  checkedAt: "2026-10-01T10:00:00.000Z",
  checkError: null,
  activeRuns: { count: 0, versions: [] },
  lastRunVersion: null,
  update: {
    state: "idle",
    trigger: null,
    startedAt: null,
    finishedAt: null,
    fromVersion: null,
    toVersion: null,
    deferredFor: 0,
    error: null,
    manualCommand: null,
    output: null,
  },
  ...overrides,
});

export interface FakeCliHost {
  clis: AgentCliStatus[];
  owner: boolean;
  /** What `POST /agent-clis/:provider/update` answers. */
  updateStatus: number;
  /** Called when the update is asked for, to move the host's state on. */
  onUpdate: (host: FakeCliHost) => void;
  calls: string[];
}

/** Routes the dashboard's fetches to a scripted host and records `METHOD /path` for each. */
export const installFakeCliHost = (initial: Partial<FakeCliHost> = {}) => {
  const host: FakeCliHost = {
    clis: [makeCli()],
    owner: true,
    updateStatus: 202,
    onUpdate: () => {},
    calls: [],
    ...initial,
  };
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace(/^.*\/api/, "");
    const method = init?.method ?? "GET";
    host.calls.push(`${method} ${path}`);
    return answer(host, method, path);
  }) as unknown as typeof fetch;
  return host;
};

const answer = (host: FakeCliHost, method: string, path: string): Response => {
  if (path === "/auth/me") {
    return Response.json(
      host.owner
        ? { kind: "owner" }
        : { kind: "device", device: { id: "d", name: "Laptop", createdAt: "", lastSeenAt: "" } },
    );
  }
  if (path === "/agent-clis" || path === "/agent-clis/check") return Response.json(body(host));
  if (method === "POST" && /^\/agent-clis\/[^/]+\/update$/.test(path)) {
    if (host.updateStatus !== 202) {
      return Response.json(
        { error: "An update of Claude Code is already running", manualCommand: null },
        { status: host.updateStatus },
      );
    }
    host.onUpdate(host);
    return Response.json({ ok: true }, { status: 202 });
  }
  return Response.json({});
};

const body = (host: FakeCliHost): AgentClisResponse => ({
  clis: host.clis,
  checkIntervalMinutes: 60,
  autoUpdate: false,
});
