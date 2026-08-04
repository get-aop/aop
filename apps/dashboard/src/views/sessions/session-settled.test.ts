import { describe, expect, test } from "bun:test";
import type { ChatSessionSummary } from "../../api/client";
import {
  canSettleSession,
  DEFAULT_AUTO_SETTLE_AFTER_DAYS,
  isSessionLifecycleBusy,
  isSessionSettled,
} from "./session-settled";

const NOW = "2026-04-10T00:00:00.000Z";
const EXACT_BOUNDARY = "2026-04-07T00:00:00.000Z";
const STALE = "2026-04-06T23:59:59.999Z";

const session = (overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary => ({
  id: "session-1",
  scope: "repository",
  repoId: "repo-1",
  repoName: "aop-mono",
  repoPath: "/tmp/aop-mono",
  workspacePath: "/tmp/aop-mono",
  title: "Session",
  named: false,
  runtime: "claude-code",
  model: "claude-opus-4-8",
  reasoningEffort: "medium",
  runtimeAlias: null,
  runtimeSessionId: null,
  fastMode: false,
  pinned: false,
  settledOverride: null,
  settledAt: null,
  lastActivityAt: null,
  hasPendingApproval: false,
  assistantActive: false,
  assistantLifecycle: "idle",
  snippet: null,
  unreadCount: 0,
  updatedAt: NOW,
  createdAt: NOW,
  ...overrides,
});

describe("isSessionSettled", () => {
  test("uses a strict three-day inactivity boundary by default", () => {
    expect(DEFAULT_AUTO_SETTLE_AFTER_DAYS).toBe(3);
    expect(isSessionSettled(session({ lastActivityAt: EXACT_BOUNDARY }), { now: NOW })).toBe(false);
    expect(isSessionSettled(session({ lastActivityAt: STALE }), { now: NOW })).toBe(true);
  });

  test("lets explicit overrides win over automatic PR and inactivity signals", () => {
    expect(
      isSessionSettled(session({ settledOverride: "active", lastActivityAt: STALE }), {
        now: NOW,
        pullRequestState: "merged",
      }),
    ).toBe(false);
    expect(
      isSessionSettled(session({ settledOverride: "settled" }), {
        now: NOW,
        autoSettleAfterDays: null,
      }),
    ).toBe(true);
  });

  test("auto-settles closed and merged pull requests", () => {
    expect(isSessionSettled(session(), { now: NOW, pullRequestState: "closed" })).toBe(true);
    expect(isSessionSettled(session(), { now: NOW, pullRequestState: "merged" })).toBe(true);
    expect(isSessionSettled(session(), { now: NOW, pullRequestState: "open" })).toBe(false);
  });

  test("keeps blocked work active even with an explicit settled override", () => {
    expect(
      isSessionSettled(session({ settledOverride: "settled", hasPendingApproval: true }), {
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isSessionSettled(session({ settledOverride: "settled", assistantLifecycle: "running" }), {
        now: NOW,
      }),
    ).toBe(false);
  });

  test("supports disabling or overriding the inactivity window", () => {
    expect(
      isSessionSettled(session({ lastActivityAt: STALE }), {
        now: NOW,
        autoSettleAfterDays: null,
      }),
    ).toBe(false);
    expect(
      isSessionSettled(session({ lastActivityAt: "2026-04-08T23:59:59.999Z" }), {
        now: NOW,
        autoSettleAfterDays: 1,
      }),
    ).toBe(true);
  });

  test("does not auto-settle missing or malformed timestamps", () => {
    expect(isSessionSettled(session(), { now: NOW })).toBe(false);
    expect(isSessionSettled(session({ lastActivityAt: "not-a-date" }), { now: NOW })).toBe(false);
    expect(isSessionSettled(session({ lastActivityAt: STALE }), { now: "not-a-date" })).toBe(false);
  });
});

describe("settlement blockers", () => {
  test("prefers an explicit idle lifecycle over a stale legacy active flag", () => {
    const idle = session({ assistantActive: true, assistantLifecycle: "idle" });
    expect(isSessionLifecycleBusy(idle)).toBe(false);
    expect(canSettleSession(idle)).toBe(true);
  });

  test("falls back to the legacy active flag when lifecycle is unavailable", () => {
    const running = session({ assistantActive: true, assistantLifecycle: undefined });
    expect(isSessionLifecycleBusy(running)).toBe(true);
    expect(canSettleSession(running)).toBe(false);
  });
});
