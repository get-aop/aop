import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeProject } from "../test-utils";

setupDashboardDom();

const { cleanup, fireEvent, screen, waitFor, within } = await import("@testing-library/react");
const { AdvancedSection } = await import("./AdvancedSection");
const { renderSection } = await import("./section-test-utils");

let api: ReturnType<typeof mockApi> | undefined;
const project = makeProject({ id: "p1", name: "Checkout" });

const renderAdvanced = async (current = project, respond?: Parameters<typeof renderSection>[2]) => {
  const rendered = await renderSection(AdvancedSection, current, respond);
  api = rendered.api;
  return rendered;
};

beforeEach(() => {
  window.history.pushState({}, "", "/projects/p1/settings/advanced");
});

afterEach(() => {
  cleanup();
  api?.restore();
});

describe("AdvancedSection", () => {
  test("pause, restart and archive sit together, and Delete is alone in the Danger zone", async () => {
    await renderAdvanced();
    const danger = within(screen.getByTestId("settings-danger-zone"));
    expect(danger.getByText("Danger zone")).toBeTruthy();
    expect(danger.getByTestId("settings-delete").textContent).toBe("Delete");
    for (const action of ["settings-pause", "settings-restart-coordinator", "settings-archive"]) {
      expect(danger.queryByTestId(action)).toBeNull();
      expect(within(screen.getByTestId("settings-lifecycle")).getByTestId(action)).toBeTruthy();
    }
  });

  test("restarting the coordinator asks, then posts", async () => {
    await renderAdvanced(project, (call) =>
      call.method === "POST" && call.path === "/projects/p1/coordinator/restart"
        ? Response.json({ project })
        : undefined,
    );
    fireEvent.click(screen.getByTestId("settings-restart-coordinator"));
    await screen.findByText("Restart the coordinator?");
    expect(api?.writes()).toEqual([]);
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.path).toBe("/projects/p1/coordinator/restart");
  });

  test("pausing asks first, then posts, and an archived project offers Restore instead", async () => {
    await renderAdvanced(project, (call) =>
      call.method === "POST" && call.path === "/projects/p1/pause"
        ? Response.json({ project: { ...project, status: "paused" } })
        : undefined,
    );
    expect(screen.getByTestId("settings-pause").textContent).toBe("Pause");
    fireEvent.click(screen.getByTestId("settings-pause"));
    await screen.findByText("Pause “Checkout”?");
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.path).toBe("/projects/p1/pause");

    cleanup();
    api?.restore();
    await renderAdvanced(makeProject({ id: "p1", name: "Checkout", status: "archived" }));
    expect(screen.queryByTestId("settings-pause")).toBeNull();
    expect(screen.getByTestId("settings-archive").textContent).toBe("Restore");
  });

  test("a paused project offers Resume, which needs no question", async () => {
    await renderAdvanced(makeProject({ id: "p1", name: "Checkout", status: "paused" }), (call) =>
      call.method === "POST" && call.path === "/projects/p1/resume"
        ? Response.json({ project })
        : undefined,
    );
    fireEvent.click(screen.getByTestId("settings-pause"));

    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.path).toBe("/projects/p1/resume");
  });

  test("deleting asks first, then deletes and leaves the project's page", async () => {
    const { stub } = await renderAdvanced(project, (call) =>
      call.method === "DELETE" && call.path === "/projects/p1"
        ? new Response(null, { status: 204 })
        : undefined,
    );
    fireEvent.click(screen.getByTestId("settings-delete"));
    await screen.findByText("Delete “Checkout”?");
    expect(api?.writes()).toEqual([]);
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(stub.calls.forgotten).toEqual(["p1"]));
    expect(window.location.pathname).toBe("/");
  });
});
