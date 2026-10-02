import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import { silentChatHost } from "../layout/test-utils";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";
import { json, mockHost } from "../thread/test-utils";
import { answerPullRequests, makeDetail } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { ProjectPage } = await import("../ProjectPage");
const { ChatApiProvider } = await import("../chat/chat-api");
const { ChatMarkdown } = await import("../chat/ChatMarkdown");
const { useRoute } = await import("../../shell/router");
const { PullRequestLinksProvider } = await import("./pull-request-links");

let host: ReturnType<typeof mockHost>;

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
  answerPullRequests(host, { detail: makeDetail() }, threadPane);
});
afterEach(() => {
  cleanup();
  host.restore();
});

const project = makeProject({ id: "p1", name: "Game", repoIds: ["repo_1"] });
const owner = makeThread({
  id: "t1",
  projectId: "p1",
  title: "Draw the impacts",
  repoId: "repo_1",
  status: "idle",
  artifacts: [
    { type: "pr", number: 752, url: "https://github.com/acme/app/pull/752", state: "open" },
  ],
});

const Routed = () => {
  const route = useRoute();
  return route.name === "projects" ? null : <ProjectPage route={route} />;
};

const mount = async () => {
  const stub = stubLiveProjects(makeState([makeEntry(project, [owner])]));
  render(
    <ChatApiProvider value={silentChatHost}>
      <ProjectsProvider live={stub.live}>
        <Routed />
      </ProjectsProvider>
    </ChatApiProvider>,
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};

describe("opening the PR View", () => {
  test("from a thread's pull request chip in the panel's overview", async () => {
    await mount();
    const chip = screen.getByTestId("thread-pr-chip");
    expect(chip.getAttribute("data-opens")).toBe("view");
    // A modified click is the browser's: GitHub in a new tab.
    expect(fireEvent.click(chip, { metaKey: true })).toBe(true);
    expect(window.location.pathname).toBe("/projects/p1");

    fireEvent.click(chip);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(window.location.pathname).toBe("/projects/p1/pulls/repo_1/752");
    expect(await screen.findByTestId("pr-title")).toBeTruthy();
  });

  test("from the thread's own pull request bar, keeping the thread open beside it", async () => {
    window.history.pushState({}, "", "/projects/p1/threads/t1");
    await mount();
    fireEvent.click(await screen.findByTestId("pr-bar-chip"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(window.location.pathname).toBe("/projects/p1/threads/t1/pulls/repo_1/752");
    expect(screen.getByTestId("thread-pane").getAttribute("data-thread-id")).toBe("t1");
  });

  test("from a pull request link in markdown, when it is one of the project's repositories", async () => {
    render(
      <PullRequestLinksProvider projectId="p1" repoIds={["repo_1"]}>
        <ChatMarkdown content="See [the PR](https://github.com/acme/app/pull/9) and [elsewhere](https://github.com/other/repo/pull/1)." />
      </PullRequestLinksProvider>,
    );
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const ours = screen.getByText("the PR");
    const theirs = screen.getByText("elsewhere");
    expect(ours.getAttribute("data-opens")).toBe("pull-request-view");
    expect(theirs.getAttribute("data-opens")).toBeNull();

    expect(fireEvent.click(theirs)).toBe(true);
    expect(window.location.pathname).toBe("/projects/p1");
    expect(fireEvent.click(ours)).toBe(false);
    expect(window.location.pathname).toBe("/projects/p1/pulls/repo_1/9");
  });
});
