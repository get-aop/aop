import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";
import { mockEmptyThreadHost, silentChatHost } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ProjectPage } = await import("../ProjectPage");
const { ChatApiProvider } = await import("../chat/chat-api");
const { SidebarProvider } = await import("@/ui/sidebar");
const { useRoute } = await import("../../shell/router");
const { openArtifactView, closeArtifactView } = await import("../artifact-view/open-artifact-view");
const { openPullRequestView } = await import("../pull-request-view/open-pull-request-view");

let host: ReturnType<typeof mockEmptyThreadHost>;
beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/p1/threads/t1");
  host = mockEmptyThreadHost();
});
afterEach(() => {
  cleanup();
  host.restore();
});

const project = makeProject({ id: "p1", name: "Checkout", repoIds: ["repo_1"] });
const thread = makeThread({
  id: "t1",
  projectId: "p1",
  title: "Audit",
  repoId: "repo_1",
  status: "idle",
});

const Routed = () => {
  const route = useRoute();
  return route.name === "projects" ? null : <ProjectPage route={route} />;
};

const mount = () => {
  const stub = stubLiveProjects(makeState([makeEntry(project, [thread])]));
  render(
    <SidebarProvider>
      <ChatApiProvider value={silentChatHost}>
        <ProjectsProvider live={stub.live}>
          <Routed />
        </ProjectsProvider>
      </ChatApiProvider>
    </SidebarProvider>,
  );
};

describe("an artifact in the chat's place", () => {
  test("hides the chat without unmounting it, keeps the thread open, and gives the chat back", async () => {
    mount();
    const coordinatorInput = () =>
      screen
        .getByTestId("chat-column")
        .querySelector('[data-testid="composer-input"]') as HTMLTextAreaElement;
    const input = coordinatorInput();
    fireEvent.change(input, { target: { value: "half a thought" } });

    act(() => openArtifactView("p1", { kind: "artifact", id: "lib_1" }));
    await act(async () => {});
    expect(window.location.pathname).toBe("/projects/p1/threads/t1/artifacts/lib_1");
    expect(screen.getByTestId("artifact-column")).toBeTruthy();
    expect(screen.getByTestId("chat-column").className).toContain("hidden");

    act(() => closeArtifactView());
    await act(async () => {});
    expect(screen.queryByTestId("artifact-column")).toBeNull();
    expect(coordinatorInput().value).toBe("half a thought");
    expect(window.location.pathname).toBe("/projects/p1/threads/t1");
  });

  test("opening a pull request replaces the artifact: one view at a time", async () => {
    mount();
    act(() => openArtifactView("p1", { kind: "artifact", id: "lib_1" }));
    act(() => openPullRequestView({ projectId: "p1", repoId: "repo_1", number: 7 }));
    await act(async () => {});
    expect(screen.queryByTestId("artifact-column")).toBeNull();
    expect(screen.getByTestId("pull-request-column")).toBeTruthy();
  });
});
