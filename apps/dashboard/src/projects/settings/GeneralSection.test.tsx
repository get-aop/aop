import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project } from "@aop/common";
import { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ConfirmationHost } = await import("../../components/ConfirmationHost");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { GeneralSection } = await import("./GeneralSection");

let api: ReturnType<typeof mockApi>;
let respond: (method: string, path: string, body: unknown) => Response | undefined;

const project = makeProject({ id: "p1", name: "Checkout", goal: "Keep checkout fast" });

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/p1/settings");
  respond = (method, path, body) =>
    method === "PATCH" && path === "/projects/p1"
      ? Response.json({ project: { ...project, ...(body as object) } })
      : undefined;
  api = mockApi((call) => respond(call.method, call.path, call.body));
});

afterEach(() => {
  cleanup();
  api.restore();
});

// Async so the switch's size read (a microtask in the test DOM) lands inside act.
const renderGeneral = async (current: Project = project) => {
  const stub = stubLiveProjects(makeState([makeEntry(current)]));
  render(
    <ProjectsProvider live={stub.live}>
      <GeneralSection project={current} />
      <ConfirmationHost />
    </ProjectsProvider>,
  );
  await act(async () => {});
  return stub;
};

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

const choose = async (triggerTestId: string, option: string | RegExp) => {
  const trigger = screen.getByTestId(triggerTestId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

const save = () => fireEvent.click(screen.getByTestId("settings-save"));

describe("GeneralSection form", () => {
  test("shows what the project has and offers nothing to save until something changes", async () => {
    await renderGeneral();
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Checkout");
    expect((screen.getByTestId("settings-goal") as HTMLTextAreaElement).value).toBe(
      "Keep checkout fast",
    );
    expect(screen.getByTestId("settings-save-bar").getAttribute("data-dirty")).toBe("false");
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("settings-save-state").textContent).toBe("Everything is saved.");
  });

  test("saves only the fields that changed and hands the result to the live state", async () => {
    const stub = await renderGeneral();
    type("settings-name", "  Checkout service ");
    type("settings-goal", "Keep checkout fast and safe");
    expect(screen.getByTestId("settings-save-bar").getAttribute("data-dirty")).toBe("true");
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      method: "PATCH",
      path: "/projects/p1",
      body: { name: "Checkout service", goal: "Keep checkout fast and safe" },
    });
    await waitFor(() => expect(stub.calls.adopted).toHaveLength(1));
    expect(stub.calls.adopted[0]?.name).toBe("Checkout service");
  });

  test("the tile beside the name picks an icon and colour, saved like any other setting", async () => {
    const stub = await renderGeneral();
    const tile = () => within(screen.getByTestId("settings-icon")).getByTestId("project-tile");
    expect(screen.getByText("Name and icon")).toBeTruthy();
    expect([tile().textContent, tile().dataset.icon, tile().dataset.color]).toEqual([
      "C",
      "letter",
      "auto",
    ]);

    fireEvent.click(screen.getByTestId("settings-icon"));
    fireEvent.click(await screen.findByTestId("project-icon-option-book"));
    fireEvent.click(screen.getByTestId("project-color-option-orange"));
    expect([tile().dataset.icon, tile().dataset.color]).toEqual(["book", "orange"]);
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ icon: "book", color: "orange" });
    await waitFor(() => expect(stub.calls.adopted[0]?.icon).toBe("book"));
  });

  test("Letter and Auto put back the fallback tile", async () => {
    await renderGeneral({ ...project, icon: "rocket", color: "teal" });
    fireEvent.click(screen.getByTestId("settings-icon"));
    fireEvent.click(await screen.findByTestId("project-icon-option-letter"));
    fireEvent.click(screen.getByTestId("project-color-option-auto"));
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ icon: null, color: null });
  });

  test("the goal counts its characters against the limit", async () => {
    await renderGeneral();
    expect(screen.getByTestId("settings-goal-count").textContent).toBe("18 / 8,000");
    type("settings-goal", "x".repeat(1234));
    expect(screen.getByTestId("settings-goal-count").textContent).toBe("1,234 / 8,000");
  });

  test("changing a field back to what the project has leaves nothing to save", async () => {
    await renderGeneral();
    type("settings-name", "Other");
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(false);
    type("settings-name", "Checkout");
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(true);
  });

  test("Discard puts the saved values back", async () => {
    await renderGeneral();
    type("settings-name", "Other");
    fireEvent.click(screen.getByTestId("settings-discard"));
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Checkout");
    expect(api.calls).toHaveLength(0);
  });

  test("a blank name cannot be saved", async () => {
    await renderGeneral();
    type("settings-name", "   ");
    expect(screen.getByTestId("settings-name-error").textContent).toBe("A project needs a name.");
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  test("a name past the limit is refused under the name field in plain words, and cannot be saved", async () => {
    await renderGeneral();
    type("settings-name", "x".repeat(101));

    expect(screen.getByTestId("settings-name-error").textContent).toBe(
      "Name can be at most 100 characters.",
    );
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  test("the host's refusal is shown and the edits stay", async () => {
    respond = () => Response.json({ error: "Project name already exists" }, { status: 409 });
    const stub = await renderGeneral();
    type("settings-name", "Taken");
    save();

    expect((await screen.findByTestId("settings-error")).textContent).toBe(
      "Project name already exists",
    );
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Taken");
    expect(stub.calls.adopted).toEqual([]);
  });

  test("a setting that changes elsewhere shows up, and an edit in progress is kept", async () => {
    const stub = stubLiveProjects(makeState([makeEntry(project)]));
    const page = (current: Project) => (
      <ProjectsProvider live={stub.live}>
        <GeneralSection project={current} />
      </ProjectsProvider>
    );
    const view = render(page(project));
    await act(async () => {});
    type("settings-name", "Mine");

    view.rerender(page({ ...project, name: "Theirs", goal: "Changed elsewhere" }));

    expect((screen.getByTestId("settings-goal") as HTMLTextAreaElement).value).toBe(
      "Changed elsewhere",
    );
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Mine");
  });
});

describe("models and effort", () => {
  test("each role can pick a model, an effort, or use the default", async () => {
    await renderGeneral();
    expect(screen.getByTestId("settings-coordinator-model").textContent).toBe("Default");
    expect(screen.getByTestId("settings-coordinator-effort").textContent).toContain("Low");
    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("High");

    await choose("settings-thread-model", "Sonnet 4.6");
    await choose("settings-coordinator-effort", "Default");
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({
      coordinator: { provider: "claude-code", model: null, effort: null },
      thread: { provider: "claude-code", model: "claude-sonnet-4-6", effort: "high" },
    });
  });

  test("a role on default names what its last run reported, and an explicit value stays as it is", async () => {
    await renderGeneral(
      makeProject({
        id: "p1",
        name: "Checkout",
        coordinator: { provider: "claude-code", model: null, effort: null },
        thread: { provider: "claude-code", model: null, effort: "high" },
        reportedRuntime: {
          coordinator: { model: "claude-opus-5-5", effort: "low" },
          thread: { model: "claude-opus-5-5", effort: null },
        },
      }),
    );

    expect(screen.getByTestId("settings-coordinator-model").textContent).toBe("Default (Opus 5.5)");
    expect(screen.getByTestId("settings-coordinator-effort").textContent).toBe("Default (Low)");
    expect(screen.getByTestId("settings-thread-model").textContent).toBe("Default (Opus 5.5)");
    expect(screen.getByTestId("settings-thread-effort").textContent).toBe("High");
  });

  test("both roles on default save no model and no effort, so nothing is passed to Claude Code", async () => {
    await renderGeneral(
      makeProject({
        id: "p1",
        name: "Checkout",
        coordinator: { provider: "claude-code", model: "claude-opus-5", effort: "high" },
        thread: { provider: "claude-code", model: "claude-sonnet-4-6", effort: "low" },
      }),
    );

    for (const role of ["coordinator", "thread"]) {
      await choose(`settings-${role}-model`, "Default");
      await choose(`settings-${role}-effort`, "Default");
    }
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({
      coordinator: { provider: "claude-code", model: null, effort: null },
      thread: { provider: "claude-code", model: null, effort: null },
    });
  });

  test("the copy says what a role on default does, and that a thread keeps what it started with", async () => {
    await renderGeneral();

    const models = screen.getByTestId("settings-models").textContent ?? "";
    expect(models).toContain("“Default” passes none, so Claude Code picks its own");
    expect(screen.getByTestId("settings-thread-runtime").textContent).toContain(
      "A new thread starts on these and keeps them",
    );
  });

  test("a model that does not take the current effort resets it to the default", async () => {
    await renderGeneral(
      makeProject({
        id: "p1",
        name: "Checkout",
        thread: { provider: "claude-code", model: "claude-opus-5", effort: "max" },
      }),
    );
    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("Max");

    await choose("settings-thread-model", "Sonnet 4.6");

    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("Default");
    // Sonnet has no Max effort to choose either.
    fireEvent.pointerDown(screen.getByTestId("settings-thread-effort"), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByTestId("settings-thread-effort"));
    await screen.findByRole("option", { name: "High" });
    expect(screen.queryByRole("option", { name: "Max" })).toBeNull();
  });
});

describe("thread access", () => {
  const editsOnly = () =>
    makeProject({ id: "p1", name: "Checkout", threadAccess: "auto-accept-edits" });

  test("a new project starts on full access, with the warning showing", async () => {
    await renderGeneral();
    expect(screen.getByTestId("settings-thread-access").getAttribute("data-value")).toBe(
      "full-access",
    );
    expect(screen.getByTestId("settings-full-access-warning").textContent).toContain(
      "can run any command on this host",
    );
  });

  test("Edit files says other commands are denied and has no warning", async () => {
    await renderGeneral(editsOnly());
    expect(screen.getByTestId("settings-thread-access").getAttribute("data-value")).toBe(
      "auto-accept-edits",
    );
    expect(screen.queryByTestId("settings-full-access-warning")).toBeNull();
    const description = screen.getByTestId("settings-thread-access-description").textContent;
    expect(description).toContain("denied");
    expect(description).toContain("no approval prompt");
    expect(description).not.toContain("until you approve");
  });

  test("choosing full access warns at once, and saving it asks first", async () => {
    await renderGeneral(editsOnly());
    await choose("settings-thread-access", "Full access");
    expect(screen.getByTestId("settings-full-access-warning").textContent).toContain(
      "can run any command on this host",
    );

    save();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Give threads full access?")).toBeTruthy();
    expect(api.writes()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ threadAccess: "full-access" });
  });

  test("declining the question saves nothing and keeps the choice", async () => {
    await renderGeneral(editsOnly());
    await choose("settings-thread-access", "Full access");
    save();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api.writes()).toHaveLength(0);
    expect(screen.getByTestId("settings-thread-access").getAttribute("data-value")).toBe(
      "full-access",
    );
  });

  test("going back to editing files needs no question and drops the warning", async () => {
    await renderGeneral();
    expect(screen.getByTestId("settings-full-access-warning")).toBeTruthy();
    await choose("settings-thread-access", "Edit files");
    expect(screen.queryByTestId("settings-full-access-warning")).toBeNull();
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ threadAccess: "auto-accept-edits" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("pull requests", () => {
  test("shows whether the host fixes them by itself, and saves turning it off", async () => {
    await renderGeneral();
    const toggle = screen.getByTestId("settings-auto-fix");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ autoFixPullRequests: false });
  });

  test("a project that has it off shows it off, and turning it back on leaves nothing to save", async () => {
    await renderGeneral(makeProject({ id: "p1", name: "Checkout", autoFixPullRequests: false }));
    const toggle = screen.getByTestId("settings-auto-fix");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByTestId("settings-save-bar").getAttribute("data-dirty")).toBe("false");
  });
});

describe("auto-continue when usage limits reset", () => {
  test("is on for a project by default, and saves turning it off", async () => {
    await renderGeneral();
    const toggle = screen.getByTestId("settings-auto-continue");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Auto-continue when usage limits reset")).toBeTruthy();

    fireEvent.click(toggle);
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ autoContinue: false });
  });

  test("a project that has it off shows it off, and saves turning it back on", async () => {
    await renderGeneral(makeProject({ id: "p1", name: "Checkout", autoContinue: false }));
    const toggle = screen.getByTestId("settings-auto-continue");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ autoContinue: true });
  });
});

describe("notifications", () => {
  test("saves the level the person picks", async () => {
    await renderGeneral();
    await choose("settings-notifications", "Off");
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ notificationLevel: "off" });
  });
});

describe("project actions and danger zone", () => {
  test("pause, restart and archive are plain rows, and only Delete sits under Danger zone", async () => {
    await renderGeneral();
    const danger = within(screen.getByTestId("settings-danger-zone"));
    expect(danger.getByTestId("settings-delete").textContent).toBe("Delete");
    for (const action of ["settings-pause", "settings-restart-coordinator", "settings-archive"]) {
      expect(danger.queryByTestId(action)).toBeNull();
      expect(within(screen.getByTestId("settings-lifecycle")).getByTestId(action)).toBeTruthy();
    }
  });

  test("restarting the coordinator asks, then posts", async () => {
    respond = (method, path) =>
      method === "POST" && path === "/projects/p1/coordinator/restart"
        ? Response.json({ project })
        : undefined;
    await renderGeneral();
    fireEvent.click(screen.getByTestId("settings-restart-coordinator"));
    await screen.findByText("Restart the coordinator?");
    expect(api.writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.path).toBe("/projects/p1/coordinator/restart");
  });

  test("pausing asks first, then posts, and an archived project offers Restore instead", async () => {
    respond = (method, path) =>
      method === "POST" && path === "/projects/p1/pause"
        ? Response.json({ project: { ...project, status: "paused" } })
        : undefined;
    await renderGeneral();
    expect(screen.getByTestId("settings-pause").textContent).toBe("Pause");
    fireEvent.click(screen.getByTestId("settings-pause"));
    await screen.findByText("Pause “Checkout”?");
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.path).toBe("/projects/p1/pause");

    cleanup();
    await renderGeneral(makeProject({ id: "p1", name: "Checkout", status: "archived" }));
    expect(screen.queryByTestId("settings-pause")).toBeNull();
    expect(screen.getByTestId("settings-archive").textContent).toBe("Restore");
  });

  test("a paused project offers Resume, which needs no question", async () => {
    respond = (method, path) =>
      method === "POST" && path === "/projects/p1/resume" ? Response.json({ project }) : undefined;
    await renderGeneral(makeProject({ id: "p1", name: "Checkout", status: "paused" }));
    fireEvent.click(screen.getByTestId("settings-pause"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.path).toBe("/projects/p1/resume");
  });

  test("deleting asks first, then deletes and leaves the project's page", async () => {
    respond = (method, path) =>
      method === "DELETE" && path === "/projects/p1"
        ? new Response(null, { status: 204 })
        : undefined;
    const stub = await renderGeneral();
    fireEvent.click(screen.getByTestId("settings-delete"));
    await screen.findByText("Delete “Checkout”?");
    expect(api.writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(stub.calls.forgotten).toEqual(["p1"]));
    expect(window.location.pathname).toBe("/");
  });
});
