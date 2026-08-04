import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatSessionSummary } from "../api/client";
import { setupDashboardDom } from "../test/setup-dom";
import { resetDialogs } from "./dialog-store";
import { type RailProps, resetRailProps, setRailProps } from "./rail-store";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppShell } = await import("./AppShell");

const summary = (overrides: Partial<ChatSessionSummary>): ChatSessionSummary =>
  ({
    id: "s1",
    scope: "repo",
    repoId: "repo_1",
    repoName: "aop-mono",
    repoPath: "/repos/aop-mono",
    workspacePath: "/repos/aop-mono",
    title: "Session",
    named: false,
    runtime: "claude-code",
    model: "opus",
    reasoningEffort: "high",
    runtimeAlias: null,
    runtimeSessionId: null,
    fastMode: false,
    pinned: false,
    settledOverride: null,
    settledAt: null,
    lastActivityAt: null,
    assistantActive: false,
    snippet: null,
    unreadCount: 0,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  }) as ChatSessionSummary;

const railProps = (): RailProps =>
  ({
    groups: [
      {
        repoId: "repo_1",
        name: "aop-mono",
        sessions: [summary({ id: "s1", title: "Fix tests" })],
      },
    ],
    tasks: [],
    settled: [],
    activeSessionId: null,
    connected: true,
    workflowCount: 2,
    onSelect: mock(() => {}),
    onNewSession: mock(() => {}),
    onNewTask: mock(() => {}),
    onAttachRepo: mock(() => {}),
    onAction: mock(() => {}),
  }) as RailProps;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(async () => new Response(JSON.stringify({ settings: [] }))) as never;
  setRailProps(railProps());
});

afterEach(() => {
  cleanup();
  resetRailProps();
  resetDialogs();
  globalThis.fetch = originalFetch;
});

/** The rail renders session titles too, so palette assertions must be scoped. */
const openPalette = async (): Promise<HTMLElement> => {
  render(
    <AppShell connection="idle" onReposChanged={() => {}}>
      <div />
    </AppShell>,
  );
  fireEvent.click(screen.getByTestId("rail-search"));
  await screen.findByPlaceholderText("Search sessions");
  return document.querySelector('[role="dialog"]') as HTMLElement;
};

describe("AppShell command palette", () => {
  test("searches sessions only — no Actions group", async () => {
    const palette = await openPalette();

    expect(within(palette).getByText("Sessions")).toBeTruthy();
    expect(within(palette).queryByText("Actions")).toBeNull();
  });

  test("does not offer New session / Workflows / Settings as palette entries", async () => {
    const palette = await openPalette();

    for (const label of ["New session", "Workflows", "Settings"]) {
      expect(within(palette).queryByText(label)).toBeNull();
    }
  });

  test("still lists sessions", async () => {
    const palette = await openPalette();

    expect(within(palette).getByText("Fix tests")).toBeTruthy();
  });
});
