import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Project } from "@aop/common";
import { setupDashboardDom } from "../test/setup-dom";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ConfirmationHost } = await import("../components/ConfirmationHost");
const { ProjectsProvider } = await import("./ProjectsProvider");
const { ProjectMenu } = await import("./ProjectMenu");

const originalFetch = globalThis.fetch;
let requests: { method: string; url: string; body: unknown }[] = [];
let respond: (method: string, url: string) => Response;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
  requests = [];
  respond = () => new Response(null, { status: 204 });
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, url: String(input), body });
    return respond(method, String(input));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const renderMenu = (project: Project) => {
  const stub = stubLiveProjects(makeState([makeEntry(project)]));
  render(
    <ProjectsProvider live={stub.live}>
      <ProjectMenu project={project}>
        <button type="button" data-testid="menu-trigger">
          menu
        </button>
      </ProjectMenu>
      <ConfirmationHost />
    </ProjectsProvider>,
  );
  return stub;
};

const open = async () => {
  fireEvent.pointerDown(screen.getByTestId("menu-trigger"), { button: 0, ctrlKey: false });
  await screen.findByTestId("project-menu");
};

describe("ProjectMenu", () => {
  test("Pin keeps the project on this device, and the same item unpins it", async () => {
    renderMenu(makeProject({ id: "p1" }));
    await open();

    expect(screen.getByTestId("project-menu-pin").textContent).toBe("Pin");
    fireEvent.click(screen.getByTestId("project-menu-pin"));
    expect(JSON.parse(window.localStorage.getItem("aop:pinned-projects:v1") ?? "[]")).toEqual([
      "p1",
    ]);

    await waitFor(() => expect(screen.queryByTestId("project-menu")).toBeNull());
    await open();
    expect(screen.getByTestId("project-menu-pin").textContent).toBe("Unpin");
    fireEvent.click(screen.getByTestId("project-menu-pin"));
    expect(JSON.parse(window.localStorage.getItem("aop:pinned-projects:v1") ?? "[]")).toEqual([]);
  });

  test("Archive posts the transition and hands the result to the live state at once", async () => {
    const archived = makeProject({ id: "p1", status: "archived" });
    respond = () => Response.json({ project: archived });
    const stub = renderMenu(makeProject({ id: "p1" }));
    await open();

    fireEvent.click(screen.getByTestId("project-menu-archive"));

    await waitFor(() => expect(stub.calls.adopted).toEqual([archived]));
    expect(requests).toEqual([
      { method: "POST", url: "/api/projects/p1/archive", body: undefined },
    ]);
  });

  test("an archived project offers Restore and no Pause", async () => {
    renderMenu(makeProject({ status: "archived" }));
    await open();

    expect(screen.getByTestId("project-menu-archive").textContent).toBe("Restore");
    expect(screen.queryByTestId("project-menu-pause")).toBeNull();
  });

  test("a paused project offers Resume", async () => {
    const resumed = makeProject({ id: "p1", status: "active" });
    respond = () => Response.json({ project: resumed });
    const stub = renderMenu(makeProject({ id: "p1", status: "paused" }));
    await open();

    expect(screen.getByTestId("project-menu-pause").textContent).toBe("Resume");
    fireEvent.click(screen.getByTestId("project-menu-pause"));

    await waitFor(() => expect(stub.calls.adopted).toEqual([resumed]));
    expect(requests[0]?.url).toBe("/api/projects/p1/resume");
  });

  test("Notifications shows the current level and patches the chosen one", async () => {
    const quiet = makeProject({ id: "p1", notificationLevel: "off" });
    respond = () => Response.json({ project: quiet });
    const stub = renderMenu(makeProject({ id: "p1" }));
    await open();

    fireEvent.keyDown(screen.getByTestId("project-menu-notifications"), { key: "ArrowRight" });
    const off = await screen.findByTestId("project-menu-notifications-off");
    expect(
      screen.getByTestId("project-menu-notifications-coordinator").getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(off);

    await waitFor(() => expect(stub.calls.adopted).toEqual([quiet]));
    expect(requests).toEqual([
      { method: "PATCH", url: "/api/projects/p1", body: { notificationLevel: "off" } },
    ]);
  });

  test("Settings opens the project's settings screen", async () => {
    renderMenu(makeProject({ id: "p1" }));
    await open();

    fireEvent.click(screen.getByTestId("project-menu-settings"));
    expect(window.location.pathname).toBe("/projects/p1/settings");
  });

  test("Delete asks first, and does nothing when the person cancels", async () => {
    const stub = renderMenu(makeProject({ id: "p1", name: "Checkout" }));
    await open();

    fireEvent.click(screen.getByTestId("project-menu-delete"));
    expect((await screen.findAllByText(/Delete “Checkout”\?/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(screen.queryByText(/Delete “Checkout”\?/)).toBeNull());
    expect(requests).toEqual([]);
    expect(stub.calls.forgotten).toEqual([]);
  });

  test("a confirmed delete removes the project and leaves its screens", async () => {
    window.history.pushState({}, "", "/projects/p1/chat");
    const stub = renderMenu(makeProject({ id: "p1", name: "Checkout" }));
    await open();

    fireEvent.click(screen.getByTestId("project-menu-delete"));
    await screen.findAllByText(/Delete “Checkout”\?/);
    fireEvent.click(screen.getByText("Delete project"));

    await waitFor(() => expect(stub.calls.forgotten).toEqual(["p1"]));
    expect(requests).toEqual([{ method: "DELETE", url: "/api/projects/p1", body: undefined }]);
    expect(window.location.pathname).toBe("/");
  });

  test("a failed action leaves the state alone", async () => {
    respond = () => Response.json({ error: "Project is busy" }, { status: 409 });
    const stub = renderMenu(makeProject({ id: "p1" }));
    await open();

    fireEvent.click(screen.getByTestId("project-menu-archive"));
    await waitFor(() => expect(requests).toHaveLength(1));

    expect(stub.calls.adopted).toEqual([]);
  });
});
