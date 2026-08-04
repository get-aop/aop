import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "./test/setup-dom";

setupDashboardDom();

const mockRefresh = mock(async () => {});

mock.module("./hooks/useTaskEvents", () => ({
  useTaskEvents: () => ({
    tasks: [],
    capacity: { working: 0, max: 5 },
    repos: [],
    connected: true,
    initialized: true,
    refresh: mockRefresh,
  }),
}));

const createApiResponseBody = (input: RequestInfo | URL) => {
  const url = String(input);

  if (url.endsWith("/api/agents")) {
    return { agents: [] };
  }

  if (url.includes("/api/chat-sessions")) {
    return { sessions: [] };
  }

  if (url.includes("/api/workflows")) {
    return { workflows: [] };
  }

  if (url.includes("/api/status")) {
    return {
      ready: true,
      capacity: { working: 0, max: 5 },
      swimlanes: [],
      tasks: [],
      repos: [],
    };
  }

  return {};
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock((input) =>
    Promise.resolve(new Response(JSON.stringify(createApiResponseBody(input)), { status: 200 })),
  ) as unknown as typeof globalThis.fetch;
  globalThis.localStorage.clear();
});

const { App } = await import("./App");
const { cleanup, render, screen } = await import("@testing-library/react");

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("App routing (one page: Sessions)", () => {
  test("opens Sessions at /", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(await screen.findByTestId("sessions-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  test("renders the app rail as the only chrome", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(await screen.findByTestId("app-rail")).toBeTruthy();
    expect(screen.getByTestId("rail-new-session")).toBeTruthy();
    expect(screen.getByTestId("rail-footer-settings")).toBeTruthy();
  });

  const LEGACY_ROUTES = ["/chat", "/pool", "/workers", "/metrics", "/workflows", "/settings"];

  for (const path of LEGACY_ROUTES) {
    test(`redirects legacy ${path} to /`, async () => {
      window.history.pushState({}, "", path);
      render(<App />);
      expect(await screen.findByTestId("sessions-page")).toBeTruthy();
      expect(window.location.pathname).toBe("/");
    });
  }

  test("redirects /workflows/:id to /", async () => {
    window.history.pushState({}, "", "/workflows/some-id");
    render(<App />);
    expect(await screen.findByTestId("sessions-page")).toBeTruthy();
    expect(window.location.pathname).toBe("/");
  });

  test("keeps /tasks/:id as the task detail deep link", async () => {
    window.history.pushState({}, "", "/tasks/task-1");
    render(<App />);
    expect(window.location.pathname).toBe("/tasks/task-1");
    // Task detail is not the sessions workspace.
    expect(screen.queryByTestId("sessions-page")).toBeNull();
  });
});
