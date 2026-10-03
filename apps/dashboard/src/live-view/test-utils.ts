import { mock } from "bun:test";
import {
  type CuaLeaseState,
  EMPTY_CUA_LEASE,
  type LiveViewMode,
  type LiveViewSession,
  type LiveViewStatus,
} from "@aop/common";

export const makeSession = (overrides: Partial<LiveViewSession> = {}): LiveViewSession => ({
  threadId: "thr_1",
  projectId: "prj_1",
  title: "Check the login page",
  startedAt: "2026-10-02T12:00:00.000Z",
  lastActivityAt: "2026-10-02T12:00:05.000Z",
  ending: false,
  ...overrides,
});

/** A lease held by `holder` (a thread, by id and title) with `waiting` threads in line behind it. */
export const makeLease = (
  holder: { threadId: string; title: string } | null,
  waiting: { threadId: string; title: string }[] = [],
): CuaLeaseState => ({
  holder: holder && {
    kind: "thread",
    projectId: "prj_1",
    since: "2026-10-02T12:00:00.000Z",
    lastCallAt: "2026-10-02T12:00:05.000Z",
    ...holder,
  },
  queue: waiting.map((waiter, index) => ({
    projectId: "prj_1",
    since: "2026-10-02T12:00:10.000Z",
    position: index + 1,
    ...waiter,
  })),
  idleReleaseMs: EMPTY_CUA_LEASE.idleReleaseMs,
});

export interface FakeLiveHost {
  mode: LiveViewMode;
  viewer: "owner" | "device";
  sessions: LiveViewSession[];
  lease: CuaLeaseState;
  /** What `GET /api/computer-use/live/frame` answers: JPEG bytes, or a refusal. */
  frame: Uint8Array | { status: number; code: string; error: string };
  statusCalls: number;
  frameCalls: number;
}

/** Answers the live view's two routes from `host`; anything else gets an empty JSON object. */
export const installFakeLiveHost = (initial: Partial<FakeLiveHost> = {}): FakeLiveHost => {
  const host: FakeLiveHost = {
    mode: "remote",
    viewer: "device",
    sessions: [makeSession()],
    lease: EMPTY_CUA_LEASE,
    frame: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    statusCalls: 0,
    frameCalls: 0,
    ...initial,
  };
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/computer-use/live")) {
      host.statusCalls += 1;
      const shown = host.mode === "always" || (host.mode === "remote" && host.viewer === "device");
      const status: LiveViewStatus = {
        mode: host.mode,
        viewer: host.viewer,
        shown,
        sessions: host.sessions,
        capture: { state: "live", detail: null },
        lease: host.lease,
      };
      return Response.json(status);
    }
    if (url.endsWith("/api/computer-use/live/frame")) {
      host.frameCalls += 1;
      const { frame } = host;
      if (frame instanceof Uint8Array) {
        return new Response(new Uint8Array(frame), {
          headers: { "Content-Type": "image/jpeg", ETag: '"1"' },
        });
      }
      return Response.json({ error: frame.error, code: frame.code }, { status: frame.status });
    }
    return Response.json({});
  }) as unknown as typeof fetch;
  return host;
};
