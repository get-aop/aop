import { describe, expect, test } from "bun:test";
import {
  type ChatDelegationRun,
  deriveDelegationViewStatus,
  formatChatDelegationKind,
  parseChatDelegationRuns,
  serializeChatDelegationRuns,
} from "./chat-delegation.ts";

const entry = (overrides: Partial<ChatDelegationRun> = {}): ChatDelegationRun => ({
  id: "del-1",
  kind: "delegation",
  label: "Codex",
  runtime: "codex-cli",
  runtimeAlias: null,
  runtimeConfigurationId: null,
  model: "gpt-5.5",
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

describe("chat-delegation serialization", () => {
  test("round-trips a delegation list through the JSON column", () => {
    const runs = [entry(), entry({ id: "del-2", status: "completed" })];
    const parsed = parseChatDelegationRuns(serializeChatDelegationRuns(runs));
    expect(parsed).toEqual(runs);
  });

  test("parses null/empty/invalid column values to an empty list", () => {
    expect(parseChatDelegationRuns(null)).toEqual([]);
    expect(parseChatDelegationRuns("")).toEqual([]);
    expect(parseChatDelegationRuns("not json")).toEqual([]);
    expect(parseChatDelegationRuns("{}")).toEqual([]);
  });

  test("serializing an empty list returns null so columns stay clean", () => {
    expect(serializeChatDelegationRuns([])).toBeNull();
  });

  test("round-trips background-task entries with toolUseId", () => {
    const runs = [
      entry({
        id: "del_bg_1",
        kind: "background-task",
        label: "Inspect renderer",
        toolUseId: "toolu_agent_1",
      }),
    ];
    const parsed = parseChatDelegationRuns(serializeChatDelegationRuns(runs));
    expect(parsed).toEqual(runs);
  });

  test("rejects unknown kinds so stale JSON cannot poison cards", () => {
    expect(
      parseChatDelegationRuns(
        JSON.stringify([{ ...entry(), kind: "not-a-kind" }, entry({ id: "del-ok" })]),
      ),
    ).toEqual([entry({ id: "del-ok" })]);
  });

  test("formatChatDelegationKind labels each kind", () => {
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
