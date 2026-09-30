import { describe, expect, test } from "bun:test";
import {
  type ChatDelegationRun,
  deriveDelegationViewStatus,
  formatChatDelegationKind,
} from "./chat-delegation.ts";

const entry = (overrides: Partial<ChatDelegationRun> = {}): ChatDelegationRun => ({
  id: "del-1",
  kind: "delegation",
  label: "Claude",
  runtime: "claude-code",
  runtimeAlias: null,
  runtimeConfigurationId: null,
  model: "claude-opus-5",
  reasoning: "high",
  fastMode: false,
  status: "active",
  activity: null,
  runtimeSessionId: null,
  logFilePath: "/tmp/delegate.jsonl",
  error: null,
  startedAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:00:00.000Z",
  ...overrides,
});

describe("formatChatDelegationKind", () => {
  test("labels each kind", () => {
    expect(formatChatDelegationKind("delegation")).toBe("% delegation");
    expect(formatChatDelegationKind("quick-action")).toBe("Quick action");
    expect(formatChatDelegationKind("background-task")).toBe("Background task");
  });
});

describe("deriveDelegationViewStatus", () => {
  const started = entry();

  test("active without activity is starting", () => {
    const now = Date.parse("2026-07-16T10:00:05.000Z");
    expect(deriveDelegationViewStatus(started, now)).toBe("starting");
  });

  test("active with recent activity is working", () => {
    const now = Date.parse("2026-07-16T10:00:20.000Z");
    const working = entry({ activity: "Running tests", updatedAt: "2026-07-16T10:00:19.000Z" });
    expect(deriveDelegationViewStatus(working, now)).toBe("working");
  });

  test("active with stale activity is waiting", () => {
    const now = Date.parse("2026-07-16T10:01:00.000Z");
    const stale = entry({ activity: "Running tests", updatedAt: "2026-07-16T10:00:10.000Z" });
    expect(deriveDelegationViewStatus(stale, now)).toBe("waiting");
  });

  test("active with no activity but old start is waiting", () => {
    const now = Date.parse("2026-07-16T10:01:00.000Z");
    expect(deriveDelegationViewStatus(started, now)).toBe("waiting");
  });

  test("terminal statuses pass through", () => {
    const now = Date.parse("2026-07-16T10:01:00.000Z");
    expect(deriveDelegationViewStatus(entry({ status: "completed" }), now)).toBe("completed");
    expect(deriveDelegationViewStatus(entry({ status: "failed" }), now)).toBe("failed");
    expect(deriveDelegationViewStatus(entry({ status: "cancelled" }), now)).toBe("cancelled");
  });
});
