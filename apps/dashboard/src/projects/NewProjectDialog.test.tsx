import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { makeProject, makeState, stubLiveProjects } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { announceRepoAttached, getDialogs, openNewProjectDialog, resetDialogs } = await import(
  "../shell/dialog-store"
);
const { ProjectsProvider } = await import("./ProjectsProvider");
const { NewProjectDialog } = await import("./NewProjectDialog");

const originalFetch = globalThis.fetch;
let repos = [{ id: "repo_1", name: "checkout", path: "/work/checkout" }];
let created: { method: string; url: string; body: Record<string, unknown> }[] = [];
let createResponse: () => Response;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
  repos = [{ id: "repo_1", name: "checkout", path: "/work/checkout" }];
  created = [];
  createResponse = () => Response.json({ project: makeProject({ id: "new" }) }, { status: 201 });
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/status") return Response.json({ repos });
    if (url === "/api/projects" && init?.method === "POST") {
      created.push({ method: "POST", url, body: JSON.parse(String(init.body)) });
      return createResponse();
    }
    return Response.json({ error: "unexpected" }, { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  resetDialogs();
  globalThis.fetch = originalFetch;
});

const renderDialog = () => {
  const stub = stubLiveProjects(makeState([]));
  render(
    <ProjectsProvider live={stub.live}>
      <NewProjectDialog />
    </ProjectsProvider>,
  );
  act(() => openNewProjectDialog());
  return stub;
};

const type = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("NewProjectDialog", () => {
  test("Create stays disabled until the project has a name", async () => {
    renderDialog();
    const submit = (await screen.findByTestId("new-project-submit")) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    type("new-project-name", "   ");
    expect(submit.disabled).toBe(true);
    type("new-project-name", "Checkout");
    expect(submit.disabled).toBe(false);
  });

  test("a name past the limit is refused under the name field, in plain words, and Create waits", async () => {
    renderDialog();
    const submit = (await screen.findByTestId("new-project-submit")) as HTMLButtonElement;
    expect(screen.queryByTestId("new-project-name-error")).toBeNull();

    type("new-project-name", "x".repeat(101));

    expect(screen.getByTestId("new-project-name-error").textContent).toBe(
      "Name can be at most 100 characters.",
    );
    expect(screen.getByTestId("new-project-name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByTestId("new-project-error")).toBeNull();
    expect(screen.getByTestId("new-project-dialog").textContent).not.toContain("Too big");
    expect(submit.disabled).toBe(true);
    fireEvent.submit(screen.getByTestId("new-project-name").closest("form") as HTMLFormElement);
    expect(created).toEqual([]);

    type("new-project-name", "x".repeat(100));
    expect(screen.queryByTestId("new-project-name-error")).toBeNull();
    expect(submit.disabled).toBe(false);
  });

  test("lists the attached repositories and creates the project with what was filled in", async () => {
    const stub = renderDialog();
    const repoRow = await screen.findByTestId("new-project-repo");
    expect(repoRow.textContent).toContain("checkout");
    expect(repoRow.textContent).toContain("/work/checkout");

    type("new-project-name", "  Checkout service  ");
    type("new-project-goal", "Keep checkout fast");
    type("new-project-instructions", "Never touch the payments schema.");
    fireEvent.click(within(repoRow).getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("new-project-submit"));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.body).toEqual({
      name: "Checkout service",
      goal: "Keep checkout fast",
      instructions: "Never touch the payments schema.",
      repoIds: ["repo_1"],
    });
    await waitFor(() => expect(getDialogs().newProject).toBe(false));
    expect(stub.calls.adopted.map((project) => project.id)).toEqual(["new"]);
    expect(window.location.pathname).toBe("/projects/new");
  });

  test("says a new project runs commands with full access, and that settings can change it", async () => {
    renderDialog();
    const notice = await screen.findByTestId("new-project-full-access-notice");
    expect(notice.textContent).toContain("full access");
    expect(notice.textContent).toContain("any command on this host");
    expect(notice.textContent).toContain("settings");
  });

  test("a project can start with no repository and only a name", async () => {
    renderDialog();
    await screen.findByTestId("new-project-repo");
    type("new-project-name", "Scratch");
    fireEvent.click(screen.getByTestId("new-project-submit"));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.body).toEqual({ name: "Scratch", goal: "", instructions: "", repoIds: [] });
  });

  test("counts the instructions against the limit", async () => {
    renderDialog();
    await screen.findByTestId("new-project-instructions");
    expect(screen.getByTestId("new-project-instructions-count").textContent).toBe("0 / 16000");

    type("new-project-instructions", "twelve chars");
    expect(screen.getByTestId("new-project-instructions-count").textContent).toBe("12 / 16000");
  });

  test("a rejected create keeps the form and says why", async () => {
    createResponse = () => Response.json({ error: "Project name already exists" }, { status: 409 });
    const stub = renderDialog();
    type("new-project-name", "Checkout");
    fireEvent.click(await screen.findByTestId("new-project-submit"));

    expect((await screen.findByTestId("new-project-error")).textContent).toBe(
      "Project name already exists",
    );
    expect(getDialogs().newProject).toBe(true);
    expect((screen.getByTestId("new-project-name") as HTMLInputElement).value).toBe("Checkout");
    expect(stub.calls.adopted).toEqual([]);
    expect((screen.getByTestId("new-project-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  test("a repository attached from the dialog appears and is selected", async () => {
    renderDialog();
    await screen.findByTestId("new-project-repo");

    repos = [...repos, { id: "repo_2", name: "storefront", path: "/work/storefront" }];
    act(() => announceRepoAttached("repo_2"));

    await waitFor(() => expect(screen.getAllByTestId("new-project-repo")).toHaveLength(2));
    const checked = screen
      .getAllByRole("checkbox")
      .filter((box) => box.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.getAttribute("aria-label")).toBe("storefront");

    type("new-project-name", "Both");
    fireEvent.click(screen.getByTestId("new-project-submit"));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.body.repoIds).toEqual(["repo_2"]);
  });

  test("says so when no repository is attached to AOP yet", async () => {
    repos = [];
    renderDialog();

    expect((await screen.findByTestId("new-project-repos")).textContent).toContain(
      "No repositories are attached",
    );
  });

  test("Cancel closes it, and reopening starts from an empty form", async () => {
    renderDialog();
    type("new-project-name", "Half typed");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("new-project-dialog")).toBeNull());

    act(() => openNewProjectDialog());
    expect(((await screen.findByTestId("new-project-name")) as HTMLInputElement).value).toBe("");
  });
});
