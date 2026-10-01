import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project, Thread } from "@aop/common";
import { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { announceRepoAttached, closeAttachRepoDialog, resetDialogs, getDialogs } = await import(
  "../../shell/dialog-store"
);
const { ProjectsProvider } = await import("../ProjectsProvider");
const { EnvironmentSection } = await import("./EnvironmentSection");

const repos = [
  { id: "repo_1", name: "checkout", path: "/work/checkout" },
  { id: "repo_2", name: "billing", path: "/work/billing" },
];

let api: ReturnType<typeof mockApi>;
let respond: (method: string, path: string, body: unknown) => Response | undefined;
let registered = repos;

beforeEach(() => {
  window.localStorage.clear();
  registered = repos;
  respond = () => undefined;
  api = mockApi((call) => {
    if (call.path === "/status") return Response.json({ repos: registered });
    return respond(call.method, call.path, call.body);
  });
});

afterEach(() => {
  cleanup();
  resetDialogs();
  api.restore();
});

const renderEnvironment = (project: Project, threads: Thread[] = []) => {
  const entry = makeEntry(project, threads);
  const stub = stubLiveProjects(makeState([entry]));
  render(
    <ProjectsProvider live={stub.live}>
      <EnvironmentSection entry={entry} />
    </ProjectsProvider>,
  );
  return stub;
};

const rowFor = (repoId: string) =>
  screen
    .getAllByTestId("settings-repo")
    .find((row) => row.getAttribute("data-repo-id") === repoId) as HTMLElement;

const openAddMenu = async () => {
  fireEvent.pointerDown(screen.getByTestId("settings-repo-add"), { button: 0, ctrlKey: false });
  return within(await screen.findByTestId("settings-repo-add-menu"));
};

const loaded = async () => {
  await waitFor(() => expect(api.calls.some((call) => call.path === "/status")).toBe(true));
  await act(async () => {});
};

const patchesRepos = (project: Project) => (method: string, path: string, body: unknown) =>
  method === "PATCH" && path === `/projects/${project.id}`
    ? Response.json({ project: { ...project, ...(body as object) } })
    : undefined;

const refuseInUse = () =>
  Response.json(
    {
      error: "A thread still works in repository repo_1; stop and delete it first",
      code: "REPO_IN_USE",
    },
    { status: 409 },
  );

describe("the project's repositories", () => {
  test("are one list of rows with a remove ×; the Add menu lists the registered ones not in it", async () => {
    renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1"] }));
    await screen.findByText("/work/checkout");

    const list = within(screen.getByTestId("settings-repos-attached"));
    expect(list.getAllByTestId("settings-repo").map((row) => row.dataset.repoId)).toEqual([
      "repo_1",
    ]);
    expect(list.getByText("checkout")).toBeTruthy();
    expect(list.getByTestId("settings-repo-detach").getAttribute("aria-label")).toBe(
      "Remove checkout",
    );
    expect(screen.getByText("Project repositories")).toBeTruthy();

    const menu = await openAddMenu();
    expect(
      menu.getAllByTestId("settings-repo-add-option").map((option) => option.dataset.repoId),
    ).toEqual(["repo_2"]);
    expect(menu.getByText("/work/billing")).toBeTruthy();
    expect(menu.getByTestId("settings-register-repo").textContent).toBe(
      "Register another repository…",
    );
  });

  test("picking one in the Add menu saves the project's repositories at once", async () => {
    const project = makeProject({ id: "p1", repoIds: ["repo_1"] });
    respond = patchesRepos(project);
    const stub = renderEnvironment(project);
    await screen.findByText("/work/checkout");

    const menu = await openAddMenu();
    fireEvent.click(menu.getByText("billing"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      method: "PATCH",
      path: "/projects/p1",
      body: { repoIds: ["repo_1", "repo_2"] },
    });
    await waitFor(() => expect(stub.calls.adopted[0]?.repoIds).toEqual(["repo_1", "repo_2"]));
  });

  test("the × saves the list without that repository", async () => {
    const project = makeProject({ id: "p1", repoIds: ["repo_1", "repo_2"] });
    respond = patchesRepos(project);
    renderEnvironment(project);
    await screen.findByText("/work/checkout");

    fireEvent.click(within(rowFor("repo_1")).getByTestId("settings-repo-detach"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ repoIds: ["repo_2"] });
  });

  test("a repository a thread works in is refused: its row says which thread holds it", async () => {
    respond = refuseInUse;
    const stub = renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1"] }), [
      makeThread({ id: "t1", projectId: "p1", title: "Fix the login redirect", repoId: "repo_1" }),
    ]);
    await screen.findByText("/work/checkout");

    fireEvent.click(within(rowFor("repo_1")).getByTestId("settings-repo-detach"));

    const problem = await within(rowFor("repo_1")).findByTestId("settings-repo-error");
    expect(problem.textContent).toBe(
      "“Fix the login redirect” still works in checkout. Stop and delete it first, then remove the repository.",
    );
    expect(stub.calls.adopted).toEqual([]);
    expect(rowFor("repo_1")).toBeTruthy();
  });

  test("with no thread known to hold it, the host's own message is shown on the row", async () => {
    respond = refuseInUse;
    renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1"] }));
    await screen.findByText("/work/checkout");

    fireEvent.click(within(rowFor("repo_1")).getByTestId("settings-repo-detach"));

    expect((await within(rowFor("repo_1")).findByTestId("settings-repo-error")).textContent).toBe(
      "A thread still works in repository repo_1; stop and delete it first",
    );
  });

  test("says so when nothing is attached, and the menu says when every repository already is", async () => {
    renderEnvironment(makeProject({ id: "p1", repoIds: [] }));
    await loaded();
    expect(screen.getByTestId("settings-repos-attached").textContent).toBe(
      "No repository is attached.",
    );
    cleanup();

    renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1", "repo_2"] }));
    await screen.findByText("/work/checkout");
    const menu = await openAddMenu();
    expect(menu.getByTestId("settings-repo-add-empty").textContent).toBe(
      "Every registered repository is already added.",
    );
  });

  test("a repository the host no longer knows is still shown, and can be removed", async () => {
    const project = makeProject({ id: "p1", repoIds: ["repo_gone"] });
    respond = patchesRepos(project);
    renderEnvironment(project);
    await loaded();

    expect(rowFor("repo_gone").textContent).toContain("repo_gone is no longer registered");
    fireEvent.click(within(rowFor("repo_gone")).getByTestId("settings-repo-detach"));
    await waitFor(() => expect(api.writes()[0]?.body).toEqual({ repoIds: [] }));
  });
});

describe("Register another repository…", () => {
  test("opens the attach dialog, and the repository it registers is added to the project", async () => {
    const project = makeProject({ id: "p1", repoIds: ["repo_1"] });
    respond = patchesRepos(project);
    renderEnvironment(project);
    await screen.findByText("/work/checkout");

    fireEvent.click((await openAddMenu()).getByTestId("settings-register-repo"));
    expect(getDialogs().attachRepo).toBe(true);

    registered = [...repos, { id: "repo_3", name: "search", path: "/work/search" }];
    act(() => {
      announceRepoAttached("repo_3");
      closeAttachRepoDialog();
    });

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ repoIds: ["repo_1", "repo_3"] });
  });

  test("a dialog that was cancelled, or a registration made elsewhere, adds nothing", async () => {
    renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1"] }));
    await screen.findByText("/work/checkout");
    fireEvent.click((await openAddMenu()).getByTestId("settings-register-repo"));
    act(() => closeAttachRepoDialog());

    registered = [...repos, { id: "repo_3", name: "search", path: "/work/search" }];
    act(() => announceRepoAttached("repo_3"));

    // The list reloads, so the new repository is offered in the menu, and nothing was saved.
    const menu = await openAddMenu();
    await waitFor(() =>
      expect(
        menu.getAllByTestId("settings-repo-add-option").map((option) => option.dataset.repoId),
      ).toEqual(["repo_2", "repo_3"]),
    );
    expect(api.writes()).toEqual([]);
  });
});
