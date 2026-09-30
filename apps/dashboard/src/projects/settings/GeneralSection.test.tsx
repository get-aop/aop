import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project } from "@aop/common";
import { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
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

const renderGeneral = (current: Project = project) => {
  const stub = stubLiveProjects(makeState([makeEntry(current)]));
  render(
    <ProjectsProvider live={stub.live}>
      <GeneralSection project={current} />
      <ConfirmationHost />
    </ProjectsProvider>,
  );
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
  test("shows what the project has and offers nothing to save until something changes", () => {
    renderGeneral();
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Checkout");
    expect((screen.getByTestId("settings-goal") as HTMLTextAreaElement).value).toBe(
      "Keep checkout fast",
    );
    expect(screen.getByTestId("settings-save-bar").getAttribute("data-dirty")).toBe("false");
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("settings-save-state").textContent).toBe("Everything is saved.");
  });

  test("saves only the fields that changed and hands the result to the live state", async () => {
    const stub = renderGeneral();
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

  test("changing a field back to what the project has leaves nothing to save", () => {
    renderGeneral();
    type("settings-name", "Other");
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(false);
    type("settings-name", "Checkout");
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(true);
  });

  test("Discard puts the saved values back", () => {
    renderGeneral();
    type("settings-name", "Other");
    fireEvent.click(screen.getByTestId("settings-discard"));
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Checkout");
    expect(api.calls).toHaveLength(0);
  });

  test("a blank name cannot be saved", () => {
    renderGeneral();
    type("settings-name", "   ");
    expect(screen.getByTestId("settings-name-error").textContent).toBe("A project needs a name.");
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  test("a name past the limit is refused under the name field in plain words, and cannot be saved", () => {
    renderGeneral();
    type("settings-name", "x".repeat(101));

    expect(screen.getByTestId("settings-name-error").textContent).toBe(
      "Name can be at most 100 characters.",
    );
    expect((screen.getByTestId("settings-save") as HTMLButtonElement).disabled).toBe(true);
    expect(api.calls).toHaveLength(0);
  });

  test("the host's refusal is shown and the edits stay", async () => {
    respond = () => Response.json({ error: "Project name already exists" }, { status: 409 });
    const stub = renderGeneral();
    type("settings-name", "Taken");
    save();

    expect((await screen.findByTestId("settings-error")).textContent).toBe(
      "Project name already exists",
    );
    expect((screen.getByTestId("settings-name") as HTMLInputElement).value).toBe("Taken");
    expect(stub.calls.adopted).toEqual([]);
  });

  test("a setting that changes elsewhere shows up, and an edit in progress is kept", () => {
    const stub = stubLiveProjects(makeState([makeEntry(project)]));
    const page = (current: Project) => (
      <ProjectsProvider live={stub.live}>
        <GeneralSection project={current} />
      </ProjectsProvider>
    );
    const view = render(page(project));
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
    renderGeneral();
    expect(screen.getByTestId("settings-coordinator-model").textContent).toContain("Use default");
    expect(screen.getByTestId("settings-coordinator-effort").textContent).toContain("Low");
    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("High");

    await choose("settings-thread-model", "Sonnet 4.6");
    await choose("settings-coordinator-effort", "Use default");
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({
      coordinator: { provider: "claude-code", model: null, effort: null },
      thread: { provider: "claude-code", model: "claude-sonnet-4-6", effort: "high" },
    });
  });

  test("both roles on default save no model and no effort, so nothing is passed to Claude Code", async () => {
    renderGeneral(
      makeProject({
        id: "p1",
        name: "Checkout",
        coordinator: { provider: "claude-code", model: "claude-opus-5", effort: "high" },
        thread: { provider: "claude-code", model: "claude-sonnet-4-6", effort: "low" },
      }),
    );

    for (const role of ["coordinator", "thread"]) {
      await choose(`settings-${role}-model`, "Use default");
      await choose(`settings-${role}-effort`, "Use default");
    }
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({
      coordinator: { provider: "claude-code", model: null, effort: null },
      thread: { provider: "claude-code", model: null, effort: null },
    });
  });

  test("the copy says what a role on default does, and that a thread keeps what it started with", () => {
    renderGeneral();

    const models = screen.getByTestId("settings-models").textContent ?? "";
    expect(models).toContain("“Use default” passes none, so Claude Code picks its own");
    expect(screen.getByTestId("settings-thread-runtime").textContent).toContain(
      "A new thread starts on these and keeps them",
    );
  });

  test("a model that does not take the current effort resets it to the default", async () => {
    renderGeneral(
      makeProject({
        id: "p1",
        name: "Checkout",
        thread: { provider: "claude-code", model: "claude-opus-5", effort: "max" },
      }),
    );
    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("Max");

    await choose("settings-thread-model", "Sonnet 4.6");

    expect(screen.getByTestId("settings-thread-effort").textContent).toContain("Use default");
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

  test("a new project starts on full access, with the warning showing", () => {
    renderGeneral();
    expect(screen.getByTestId("settings-thread-access").getAttribute("data-value")).toBe(
      "full-access",
    );
    expect(screen.getByTestId("settings-full-access-warning").textContent).toContain(
      "can run any command on this host",
    );
  });

  test("Edit files says other commands are denied and has no warning", () => {
    renderGeneral(editsOnly());
    expect(screen.getByTestId("settings-thread-access").getAttribute("data-value")).toBe(
      "auto-accept-edits",
    );
    expect(screen.queryByTestId("settings-full-access-warning")).toBeNull();
    const label = screen.getByTestId("settings-thread-access-auto-accept-edits").closest("label");
    expect(label?.textContent).toContain("denied");
    expect(label?.textContent).toContain("no approval prompt");
    expect(label?.textContent).not.toContain("until you approve");
  });

  test("choosing full access warns at once, and saving it asks first", async () => {
    renderGeneral(editsOnly());
    fireEvent.click(screen.getByTestId("settings-thread-access-full-access"));
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
    renderGeneral(editsOnly());
    fireEvent.click(screen.getByTestId("settings-thread-access-full-access"));
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
    renderGeneral();
    expect(screen.getByTestId("settings-full-access-warning")).toBeTruthy();
    fireEvent.click(screen.getByTestId("settings-thread-access-auto-accept-edits"));
    expect(screen.queryByTestId("settings-full-access-warning")).toBeNull();
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ threadAccess: "auto-accept-edits" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("pull requests", () => {
  test("shows whether the host fixes them by itself, and saves turning it off", async () => {
    renderGeneral();
    const box = screen.getByTestId("settings-auto-fix") as HTMLInputElement;
    expect(box.checked).toBe(true);

    fireEvent.click(box);
    expect(box.checked).toBe(false);
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ autoFixPullRequests: false });
  });

  test("a project that has it off shows it off, and turning it back on leaves nothing to save", () => {
    renderGeneral(makeProject({ id: "p1", name: "Checkout", autoFixPullRequests: false }));
    const box = screen.getByTestId("settings-auto-fix") as HTMLInputElement;
    expect(box.checked).toBe(false);

    fireEvent.click(box);
    fireEvent.click(box);

    expect(screen.getByTestId("settings-save-bar").getAttribute("data-dirty")).toBe("false");
  });
});

describe("notifications", () => {
  test("saves the level the person picks", async () => {
    renderGeneral();
    await choose("settings-notifications", "Off");
    save();

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ notificationLevel: "off" });
  });
});

describe("coordinator and danger zone", () => {
  test("restarting the coordinator asks, then posts", async () => {
    respond = (method, path) =>
      method === "POST" && path === "/projects/p1/coordinator/restart"
        ? Response.json({ project })
        : undefined;
    renderGeneral();
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
    renderGeneral();
    expect(screen.getByTestId("settings-pause").textContent).toBe("Pause");
    fireEvent.click(screen.getByTestId("settings-pause"));
    await screen.findByText("Pause “Checkout”?");
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.path).toBe("/projects/p1/pause");

    cleanup();
    renderGeneral(makeProject({ id: "p1", name: "Checkout", status: "archived" }));
    expect(screen.queryByTestId("settings-pause")).toBeNull();
    expect(screen.getByTestId("settings-archive").textContent).toBe("Restore");
  });

  test("a paused project offers Resume, which needs no question", async () => {
    respond = (method, path) =>
      method === "POST" && path === "/projects/p1/resume" ? Response.json({ project }) : undefined;
    renderGeneral(makeProject({ id: "p1", name: "Checkout", status: "paused" }));
    fireEvent.click(screen.getByTestId("settings-pause"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.path).toBe("/projects/p1/resume");
  });

  test("deleting asks first, then deletes and leaves the project's page", async () => {
    respond = (method, path) =>
      method === "DELETE" && path === "/projects/p1"
        ? new Response(null, { status: 204 })
        : undefined;
    const stub = renderGeneral();
    fireEvent.click(screen.getByTestId("settings-delete"));
    await screen.findByText("Delete “Checkout”?");
    expect(api.writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(stub.calls.forgotten).toEqual(["p1"]));
    expect(window.location.pathname).toBe("/");
  });
});
