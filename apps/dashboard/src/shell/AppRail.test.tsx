import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatSessionSummary } from "../api/client";
import { setupDashboardDom } from "../test/setup-dom";
import { resetDialogs } from "./dialog-store";
import { type RailProps, resetRailProps, setRailProps } from "./rail-store";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { SidebarProvider } = await import("../ui/sidebar");
const { AppRail } = await import("./AppRail");

const summary = (overrides: Partial<ChatSessionSummary>): ChatSessionSummary => ({
  id: "s1",
  scope: "repo" as ChatSessionSummary["scope"],
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
});

const railProps = (overrides: Partial<RailProps> = {}): RailProps => ({
  groups: [
    {
      repoId: "repo_1",
      name: "aop-mono",
      sessions: [summary({ id: "s1", title: "Fix tests" })],
    },
    {
      repoId: "repo_2",
      name: "pi",
      sessions: [summary({ id: "s2", title: "Rail rework", repoId: "repo_2", repoName: "pi" })],
    },
  ],
  tasks: [summary({ id: "s3", title: "Loose task", repoId: null, repoName: "Tasks" })],
  settled: [summary({ id: "s9", title: "Old thread" })],
  activeSessionId: null,
  connected: true,
  workflowCount: 2,
  onSelect: mock(() => {}),
  onNewSession: mock(() => {}),
  onNewTask: mock(() => {}),
  onAttachRepo: mock(() => {}),
  onAction: mock(() => {}),
  ...overrides,
});

const renderRail = (props: RailProps) => {
  setRailProps(props);
  return render(
    <SidebarProvider>
      <AppRail connection="idle" onOpenCommand={() => {}} />
    </SidebarProvider>,
  );
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
  ) as unknown as typeof globalThis.fetch;
  globalThis.localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetRailProps();
  resetDialogs();
  cleanup();
});

describe("AppRail", () => {
  test("no repos: attach-repository empty state instead of a blank rail", () => {
    const props = railProps({ groups: [], tasks: [], settled: [] });
    renderRail(props);

    expect(screen.getByText("No repositories yet")).toBeTruthy();
    fireEvent.click(screen.getByTestId("rail-attach-empty-cta"));
    expect(props.onAttachRepo).toHaveBeenCalled();
  });

  test("renders the flat thread list with repo tags in All scope", () => {
    renderRail(railProps());

    expect(screen.getByText("Fix tests")).toBeTruthy();
    expect(screen.getByText("Rail rework")).toBeTruthy();
    expect(screen.getByText("Loose task")).toBeTruthy();
    // Multi-repo scope → repo tags visible (chip + row tag share the name).
    expect(screen.getAllByText("aop-mono").length).toBeGreaterThan(1);
    expect(screen.getAllByText("pi").length).toBeGreaterThan(1);
  });

  test("scope chips filter the thread list and hide repo tags in single-repo scope", () => {
    renderRail(railProps());

    fireEvent.click(screen.getByRole("button", { name: "aop-mono" }));

    expect(screen.getByText("Fix tests")).toBeTruthy();
    expect(screen.queryByText("Rail rework")).toBeNull();
    // Repo-less tasks are only visible in All scope.
    expect(screen.queryByText("Loose task")).toBeNull();
    // Single-repo scope → no repo tags.
    expect(screen.queryByTestId("rail-thread-list")?.textContent ?? "").not.toContain("aop-mono");
  });

  test("scope persists and resets via the All chip", () => {
    renderRail(railProps());

    fireEvent.click(screen.getByRole("button", { name: "pi" }));
    expect(globalThis.localStorage.getItem("aop:repo-scope:v1")).toBe('["repo_2"]');

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(globalThis.localStorage.getItem("aop:repo-scope:v1")).toBeNull();
    expect(screen.getByText("Rail rework")).toBeTruthy();
  });

  test("hover actions: settle + menu per row", () => {
    const props = railProps();
    renderRail(props);

    const row = screen.getByText("Fix tests").closest("[data-session-id='s1']") as HTMLElement;
    expect(row).toBeTruthy();
    expect(within(row).getByTestId("rail-row-settle")).toBeTruthy();
    expect(within(row).getByTestId("rail-row-menu")).toBeTruthy();

    fireEvent.click(within(row).getByTestId("rail-row-settle"));
    expect(props.onAction).toHaveBeenCalledWith("s1", "settle");
  });

  test("row menu routes rename/pin/delete actions", async () => {
    const props = railProps();
    renderRail(props);

    const row = screen.getByText("Fix tests").closest("[data-session-id='s1']") as HTMLElement;
    const trigger = within(row).getByTestId("rail-row-menu");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("Rename"));
    expect(props.onAction).toHaveBeenCalledWith("s1", "rename");
  });

  test("row actions sit beside the repo tag instead of covering it", () => {
    renderRail(railProps());

    const row = screen.getByText("Fix tests").closest("[data-session-id='s1']") as HTMLElement;
    const actions = within(row).getByTestId("rail-row-menu").closest("span") as HTMLElement;

    // Absolute positioning is what used to overlay the repo name.
    expect(actions.className).not.toContain("absolute");
    expect(actions.className).toContain("shrink-0");

    // Hover is scoped to the row: the sidebar wrapper is itself a `group`, so a
    // bare group-hover reveals every row's actions at once.
    expect(row.className).toContain("group/row");
    expect(actions.className).toContain("group-hover/row:flex");
    expect(actions.className).not.toContain(" group-hover:flex");
  });

  test("repo tag truncates and yields width so the title never collapses", () => {
    renderRail(railProps());

    const row = screen.getByText("Fix tests").closest("[data-session-id='s1']") as HTMLElement;
    const tag = within(row).getByTitle("aop-mono");

    expect(tag.className).toContain("min-w-0");
    expect(tag.className).toContain("max-w-[45%]");
    expect(tag.querySelector(".truncate")?.textContent).toBe("aop-mono");
  });

  test("open row menu keeps its trigger laid out so the popup stays anchored", async () => {
    renderRail(railProps());

    const row = screen.getByText("Fix tests").closest("[data-session-id='s1']") as HTMLElement;
    const trigger = within(row).getByTestId("rail-row-menu");
    const actions = trigger.closest("span") as HTMLElement;

    // Hover-only visibility would collapse the trigger to a 0x0 rect once the
    // pointer leaves, and the menu would reanchor to the viewport origin.
    expect(actions.className).toContain("has-[[data-state=open]]:flex");

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await screen.findByText("Rename");
    expect(trigger.getAttribute("data-state")).toBe("open");
  });

  test("settled group is a full-width collapsible", async () => {
    renderRail(railProps());

    const toggle = screen.getByTestId("rail-settled");
    expect(toggle.textContent).toContain("Settled · 1");
    expect(screen.queryByText("Old thread")).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText("Old thread")).toBeTruthy();
  });

  test("footer shows workflows count and settings entry", () => {
    renderRail(railProps());

    expect(screen.getByTestId("rail-footer-workflows").textContent).toContain("2");
    expect(screen.getByTestId("rail-footer-settings").textContent).toContain("Settings");
  });

  test("new session: single-repo scope goes straight into the draft", () => {
    const props = railProps({
      groups: [{ repoId: "repo_1", name: "aop-mono", sessions: [] }],
      tasks: [],
      settled: [],
    });
    renderRail(props);

    fireEvent.click(screen.getByTestId("rail-new-session"));
    expect(props.onNewSession).toHaveBeenCalledWith("repo_1");
  });

  test("new session: multi-repo scope opens the chooser dialog", async () => {
    const props = railProps();
    renderRail(props);

    fireEvent.click(screen.getByTestId("rail-new-session"));
    // Chooser is hosted by AppShell; the store flips open.
    const { getDialogs } = await import("./dialog-store");
    expect(getDialogs().newSession).toBe(true);
  });
});
