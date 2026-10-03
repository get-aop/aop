import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { silentChatHost } from "../layout/test-utils";
import type { ProjectsState } from "../projects-state";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";
import { json, mockHost } from "../thread/test-utils";
import { answerPullRequests, makeDetail } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ProjectPage } = await import("../ProjectPage");
const { ChatApiProvider } = await import("../chat/chat-api");
const { useRoute } = await import("../../shell/router");
const { openPullRequestView } = await import("./open-pull-request-view");

let host: ReturnType<typeof mockHost>;

// What a thread's pane asks when it opens, with nothing to show.
const threadPane = (url: string) => {
  if (url.endsWith("/messages")) return json({ messages: [] });
  if (url.endsWith("/activity")) return json({ turns: [] });
  if (url.endsWith("/status")) return json({ repos: [] });
  return json({ defaultBranch: "main", files: [], perFileLineCap: 2000, summaryOnly: true });
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/p1");
  host = mockHost();
  answerPullRequests(host, { detail: makeDetail({ number: 752 }) }, threadPane);
});
afterEach(() => {
  cleanup();
  host.restore();
});

const project = makeProject({ id: "p1", name: "Checkout", repoIds: ["repo_1"] });
const owner = makeThread({
  id: "t1",
  projectId: "p1",
  title: "Ship the checkout fix",
  repoId: "repo_1",
  status: "idle",
  artifacts: [
    { type: "pr", number: 752, url: "https://github.com/acme/app/pull/752", state: "open" },
  ],
});
const state: ProjectsState = makeState([makeEntry(project, [owner])]);

const Routed = () => {
  const route = useRoute();
  return route.name === "projects" || route.name === "inbox" ? null : <ProjectPage route={route} />;
};

const mount = () => {
  const stub = stubLiveProjects(state);
  render(
    <ChatApiProvider value={silentChatHost}>
      <ProjectsProvider live={stub.live}>
        <Routed />
      </ProjectsProvider>
    </ChatApiProvider>,
  );
};

const open = async (number = 752) => {
  act(() => openPullRequestView({ projectId: "p1", repoId: "repo_1", number }));
  await act(async () => {});
};

const chatColumn = () => screen.getByTestId("chat-column");
const pane = () => screen.queryByTestId("pull-request-pane");
const pressEscape = (target: Element = document.body) =>
  act(() => {
    fireEvent.keyDown(target, { key: "Escape" });
  });

describe("the pull request in the chat's place", () => {
  test("hides the chat without unmounting it, and its draft is there when it comes back", async () => {
    mount();
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "half a thought" } });

    await open();
    expect(pane()).toBeTruthy();
    expect(chatColumn().className).toContain("hidden");
    expect(screen.getByTestId("composer-input")).toBe(input);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain(
      "CoordinatorPR #752",
    );

    fireEvent.click(screen.getByTestId("pull-request-pane-coordinator"));
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(chatColumn().className).not.toContain("hidden");
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe(
      "half a thought",
    );
  });

  test("takes focus from the hidden composer, so Escape reaches it", async () => {
    mount();
    const input = screen.getByTestId("composer-input");
    input.focus();
    await open();
    expect(document.activeElement).toBe(screen.getByTestId("pull-request-pane"));

    pressEscape(document.activeElement as Element);
    await act(async () => {});
    expect(pane()).toBeNull();
  });

  test("a deep link opens it, and × closes it", async () => {
    window.history.pushState({}, "", "/projects/p1/pulls/repo_1/752");
    mount();
    expect(pane()).toBeTruthy();

    fireEvent.click(screen.getByTestId("pull-request-pane-close"));
    await act(async () => {});
    expect(window.location.pathname).toBe("/projects/p1");
    expect(pane()).toBeNull();
  });

  test("Escape closes it, but not while typing or while a dialog or menu is open", async () => {
    mount();
    await open();

    const field = document.createElement("textarea");
    document.body.append(field);
    pressEscape(field);
    expect(pane()).toBeTruthy();
    field.remove();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    pressEscape();
    expect(pane()).toBeTruthy();
    dialog.remove();

    pressEscape();
    await act(async () => {});
    expect(pane()).toBeNull();
    expect(window.location.pathname).toBe("/projects/p1");
  });

  test("back and forward move between the chat and the pull request", async () => {
    mount();
    await open();
    await open(753);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("#753");

    act(() => window.history.back());
    await act(async () => {});
    expect(window.location.pathname).toBe("/projects/p1/pulls/repo_1/752");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("#752");

    act(() => window.history.back());
    await act(async () => {});
    expect(pane()).toBeNull();

    act(() => window.history.forward());
    await act(async () => {});
    expect(pane()).toBeTruthy();
  });

  test("opened from a thread, the thread stays open in the panel; closing the thread keeps the pull request", async () => {
    window.history.pushState({}, "", "/projects/p1/threads/t1");
    mount();
    await open();
    expect(window.location.pathname).toBe("/projects/p1/threads/t1/pulls/repo_1/752");
    expect(screen.getByTestId("thread-pane").getAttribute("data-thread-id")).toBe("t1");

    fireEvent.click(screen.getByTestId("panel-close"));
    await act(async () => {});
    expect(window.location.pathname).toBe("/projects/p1/pulls/repo_1/752");
    expect(pane()).toBeTruthy();
  });

  test("names the thread that opened the pull request and opens it in the panel beside it", async () => {
    mount();
    await open();
    const link = await screen.findByTestId("pull-request-view-thread");
    expect(link.textContent).toBe("Ship the checkout fix");

    fireEvent.click(link);
    await act(async () => {});
    expect(window.location.pathname).toBe("/projects/p1/threads/t1/pulls/repo_1/752");
    expect(screen.getByTestId("thread-pane").getAttribute("data-thread-id")).toBe("t1");
    expect(pane()).toBeTruthy();
  });
});
