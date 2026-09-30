import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project, Thread } from "@aop/common";
import { mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { announceRepoAttached, resetDialogs, getDialogs } = await import("../../shell/dialog-store");
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

const patchesRepos = (project: Project) => (method: string, path: string, body: unknown) =>
  method === "PATCH" && path === `/projects/${project.id}`
    ? Response.json({ project: { ...project, ...(body as object) } })
    : undefined;

describe("EnvironmentSection", () => {
  test("splits the registered repositories into attached and available", async () => {
    renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1"] }));
    await screen.findAllByTestId("settings-repo");

    const attached = within(screen.getByTestId("settings-repos-attached"));
    expect(attached.getByText("checkout")).toBeTruthy();
    expect(attached.getByText("/work/checkout")).toBeTruthy();
    const available = within(screen.getByTestId("settings-repos-available"));
    expect(available.getByText("billing")).toBeTruthy();
    expect(rowFor("repo_2").getAttribute("data-attached")).toBe("false");
  });

  test("attaching saves the project's repositories at once", async () => {
    const project = makeProject({ id: "p1", repoIds: ["repo_1"] });
    respond = patchesRepos(project);
    const stub = renderEnvironment(project);
    await screen.findAllByTestId("settings-repo");

    fireEvent.click(within(rowFor("repo_2")).getByTestId("settings-repo-attach"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toEqual({
      method: "PATCH",
      path: "/projects/p1",
      body: { repoIds: ["repo_1", "repo_2"] },
    });
    await waitFor(() => expect(stub.calls.adopted[0]?.repoIds).toEqual(["repo_1", "repo_2"]));
  });

  test("detaching saves the list without that repository", async () => {
    const project = makeProject({ id: "p1", repoIds: ["repo_1", "repo_2"] });
    respond = patchesRepos(project);
    renderEnvironment(project);
    await screen.findAllByTestId("settings-repo");

    fireEvent.click(within(rowFor("repo_1")).getByTestId("settings-repo-detach"));

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({ repoIds: ["repo_2"] });
  });

  test("a repository a thread works in cannot be detached: the row says which thread holds it", async () => {
    respond = () =>
      Response.json(
        {
          error: "A thread still works in repository repo_1; stop and delete it first",
          code: "REPO_IN_USE",
        },
        { status: 409 },
      );
    const project = makeProject({ id: "p1", repoIds: ["repo_1"] });
    const stub = renderEnvironment(project, [
      makeThread({ id: "t1", projectId: "p1", title: "Fix the login redirect", repoId: "repo_1" }),
    ]);
    await screen.findAllByTestId("settings-repo");

    fireEvent.click(within(rowFor("repo_1")).getByTestId("settings-repo-detach"));

    const problem = await within(rowFor("repo_1")).findByTestId("settings-repo-error");
    expect(problem.textContent).toBe(
      "“Fix the login redirect” still works in checkout. Stop and delete it first, then detach the repository.",
    );
    expect(stub.calls.adopted).toEqual([]);
    expect(rowFor("repo_1").getAttribute("data-attached")).toBe("true");
  });

  describe("the refusal names what holds the repository, and only an unresolved thread still works in it", () => {
    const refuse = () =>
      Response.json(
        {
          error: "A thread still works in repository repo_1; stop and delete it first",
          code: "REPO_IN_USE",
        },
        { status: 409 },
      );
    const thread = (id: string, title: string, status: Thread["status"], repoId = "repo_1") =>
      makeThread({ id, projectId: "p1", title, repoId, status });
    const detachMessage = async (threads: Thread[]) => {
      respond = refuse;
      renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1"] }), threads);
      await screen.findAllByTestId("settings-repo");
      fireEvent.click(within(rowFor("repo_1")).getByTestId("settings-repo-detach"));
      return (await screen.findByTestId("settings-repo-error")).textContent;
    };

    test("unresolved threads alone: they still work there, and are stopped and deleted", async () => {
      expect(await detachMessage([thread("t1", "Live work", "idle")])).toBe(
        "“Live work” still works in checkout. Stop and delete it first, then detach the repository.",
      );
      cleanup();
      expect(await detachMessage([thread("t1", "A", "working"), thread("t2", "B", "idle")])).toBe(
        "2 threads still work in checkout. Stop and delete them first, then detach the repository.",
      );
    });

    test("unresolved and resolved threads: the resolved ones are counted apart, as belonging to it", async () => {
      expect(
        await detachMessage([
          thread("t1", "Live work", "idle"),
          thread("t2", "Old fix", "resolved"),
          thread("t3", "Older fix", "resolved"),
        ]),
      ).toBe(
        "“Live work” still works in checkout, and 2 resolved threads belong to it. Stop and delete them, then detach the repository.",
      );
      cleanup();
      expect(
        await detachMessage([
          thread("t1", "A", "working"),
          thread("t2", "B", "queued"),
          thread("t3", "Old fix", "resolved"),
        ]),
      ).toBe(
        "2 threads still work in checkout, and 1 resolved thread belongs to it. Stop and delete them, then detach the repository.",
      );
    });

    test("resolved threads alone: they are never said to work there, and deleting them lets the repository go", async () => {
      const resolved = await detachMessage([
        thread("t1", "Old fix", "resolved"),
        thread("t2", "Older fix", "resolved"),
      ]);

      expect(resolved).toBe(
        "2 resolved threads belong to checkout. Delete them, then detach the repository.",
      );
      expect(resolved).not.toContain("still work");
      cleanup();
      expect(await detachMessage([thread("t1", "Old fix", "resolved")])).toBe(
        "1 resolved thread belongs to checkout. Delete it, then detach the repository.",
      );
    });

    test("threads of another repository are not named", async () => {
      expect(
        await detachMessage([
          thread("t1", "Live work", "idle"),
          thread("t2", "Elsewhere", "working", "repo_2"),
          thread("t3", "Old elsewhere", "resolved", "repo_2"),
        ]),
      ).toBe(
        "“Live work” still works in checkout. Stop and delete it first, then detach the repository.",
      );
    });
  });

  test("with no thread known to hold it, the host's own message is shown", async () => {
    respond = () =>
      Response.json(
        {
          error: "A thread still works in repository repo_1; stop and delete it first",
          code: "REPO_IN_USE",
        },
        { status: 409 },
      );
    renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1"] }));
    await screen.findAllByTestId("settings-repo");

    fireEvent.click(within(rowFor("repo_1")).getByTestId("settings-repo-detach"));

    expect((await screen.findByTestId("settings-repo-error")).textContent).toBe(
      "A thread still works in repository repo_1; stop and delete it first",
    );
  });

  test("says so when nothing is attached, and when every repository already is", async () => {
    renderEnvironment(makeProject({ id: "p1", repoIds: [] }));
    expect((await screen.findByTestId("settings-repos-attached")).textContent).toBe(
      "No repository is attached.",
    );
    cleanup();

    renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1", "repo_2"] }));
    await screen.findAllByTestId("settings-repo");
    expect(screen.getByTestId("settings-repos-available").textContent).toBe(
      "Every repository AOP knows is attached.",
    );
  });

  test("a repository registered from the dialog appears as available", async () => {
    renderEnvironment(makeProject({ id: "p1", repoIds: ["repo_1"] }));
    await screen.findAllByTestId("settings-repo");
    expect(screen.getAllByTestId("settings-repo")).toHaveLength(2);

    registered = [...repos, { id: "repo_3", name: "search", path: "/work/search" }];
    act(() => announceRepoAttached("repo_3"));

    await waitFor(() => expect(screen.getAllByTestId("settings-repo")).toHaveLength(3));
    expect(rowFor("repo_3").getAttribute("data-attached")).toBe("false");
  });

  test("Register another repository opens the attach dialog", async () => {
    renderEnvironment(makeProject({ id: "p1", repoIds: [] }));
    await screen.findAllByTestId("settings-repo");
    fireEvent.click(screen.getByTestId("settings-register-repo"));
    expect(getDialogs().attachRepo).toBe(true);
  });

  test("a repository the host no longer knows is still shown, and can be detached", async () => {
    const project = makeProject({ id: "p1", repoIds: ["repo_gone"] });
    respond = patchesRepos(project);
    renderEnvironment(project);
    await screen.findAllByTestId("settings-repo");

    expect(rowFor("repo_gone").textContent).toContain("repo_gone is no longer registered");
    fireEvent.click(within(rowFor("repo_gone")).getByTestId("settings-repo-detach"));
    await waitFor(() => expect(api.writes()[0]?.body).toEqual({ repoIds: [] }));
  });
});
