import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { PullRequestViewDetail } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeThread } from "../test-utils";
import { hostError, mockHost } from "../thread/test-utils";
import { answerPullRequests, makeCheck, makeDetail, makeFile } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { PullRequestView } = await import("./PullRequestView");
const { ConfirmationHost } = await import("../../components/ConfirmationHost");
const { coordinatorMessage, suggestedQuestion } = await import("./AskCoordinator");
const { checkCounts } = await import("./PullRequestHeader");

let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  window.localStorage.clear();
  host = mockHost();
});
afterEach(() => {
  cleanup();
  host.restore();
});

const PULL = "/api/projects/p1/github/repos/repo_1/pulls/752";
const project = makeProject({ id: "p1", name: "Game", repoIds: ["repo_1"] });

const mount = async (
  detail: PullRequestViewDetail | Response = makeDetail(),
  { onAsk = mock(async () => true), threads = [] as ReturnType<typeof makeThread>[] } = {},
) => {
  answerPullRequests(host, { detail, files: { files: [makeFile()], truncated: false } });
  render(
    <>
      <ConfirmationHost />
      <PullRequestView
        entry={makeEntry(project, threads)}
        pullRequest={{ repoId: "repo_1", number: 752 }}
        onAsk={onAsk}
      />
    </>,
  );
  await settle();
  return { onAsk };
};

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const click = async (element: Element) => {
  fireEvent.click(element);
  await settle();
};
const confirm = async () =>
  click(
    within(await screen.findByRole("alertdialog"))
      .getAllByRole("button")
      .at(-1) as Element,
  );
const writes = () => host.requests.filter((request) => request.method !== "GET");

describe("the PR View", () => {
  test("shows a skeleton until the host answers", () => {
    host.respondWith(() => new Promise(() => {}));
    render(
      <PullRequestView
        entry={makeEntry(project)}
        pullRequest={{ repoId: "repo_1", number: 752 }}
        onAsk={mock()}
      />,
    );
    expect(screen.getByTestId("pull-request-view-loading")).toBeTruthy();
  });

  test("the header: title and number, state, who merges what into where, the branch to copy, the checks", async () => {
    await mount();
    expect(screen.getByTestId("pr-title").textContent).toContain(
      "Show monster ability impacts #752",
    );
    expect(screen.getByTestId("pr-state-badge").getAttribute("data-state")).toBe("open");
    expect(screen.getByTestId("pr-merge-sentence").textContent).toBe(
      "ada wants to merge 1 commit into main from ticket/impacts",
    );
    expect(screen.getByTestId("pr-checks-summary").textContent).toBe(
      "All checks have passed (1 successful check)",
    );
    expect(screen.getByTestId("pr-open-github").getAttribute("href")).toBe(
      "https://github.com/acme/app/pull/752",
    );

    const writeText = mock(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await click(screen.getByTestId("pr-copy-branch"));
    expect(writeText).toHaveBeenCalledWith("ticket/impacts");
  });

  test("the four tabs with their counts; each shows its content", async () => {
    await mount();
    const label = (tab: string) => screen.getByTestId(`pr-tab-${tab}`).textContent;
    expect([label("conversation"), label("commits"), label("checks"), label("files")]).toEqual([
      "Conversation1",
      "Commits1",
      "Checks1",
      "Files changed2",
    ]);
    expect(screen.getByTestId("pr-description").textContent).toContain("Impacts were invisible");
    expect(screen.getByTestId("pr-comment").textContent).toContain("bobcommented");
    expect(screen.getByTestId("pr-comment").textContent).toContain("Looks good");

    // Radix tabs switch on mouse down.
    fireEvent.mouseDown(screen.getByTestId("pr-tab-commits"));
    await settle();
    expect(screen.getByTestId("pr-commits-tab").textContent).toContain("Draw impacts");

    fireEvent.mouseDown(screen.getByTestId("pr-tab-checks"));
    await settle();
    const check = screen.getByTestId("pr-check");
    expect(check.textContent).toContain("build / test");
    expect(check.textContent).toContain("Required");
    expect(within(check).getByTestId("pr-check-details").getAttribute("href")).toContain(
      "/actions/runs/1",
    );

    fireEvent.mouseDown(screen.getByTestId("pr-tab-files"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(await screen.findByTestId("pr-files-tab")).toBeTruthy();
    expect(screen.getByTestId("pr-files-count").textContent).toBe("1 file changed");
    expect(screen.getByTestId("pr-header").getAttribute("data-compact")).toBe("true");
  });

  test("says how many older events are only on GitHub, and nothing when none are", async () => {
    await mount();
    expect(screen.queryByTestId("pr-timeline-omitted")).toBeNull();
    cleanup();
    await mount(makeDetail({ timelineOmitted: 40 }));
    expect(screen.getByTestId("pr-timeline-omitted").textContent).toContain(
      "40 earlier events are only on GitHub.",
    );
  });

  test("the sidebar: the AOP thread that opened it, reviewers, assignees, labels, milestone, issues", async () => {
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
    await mount(makeDetail(), { threads: [owner] });
    expect(screen.getByTestId("pull-request-view-thread").textContent).toBe("Draw the impacts");
    expect(screen.getByTestId("pr-reviewer").getAttribute("data-state")).toBe("approved");
    expect(screen.getByTestId("pr-sidebar-assignees").textContent).toContain("ada");
    expect(screen.getByTestId("pr-label").textContent).toBe("client");
    expect(screen.getByTestId("pr-sidebar-milestone").textContent).toContain("v1");
    expect(screen.getByTestId("pr-sidebar-issues").textContent).toContain(
      "Impacts are invisible #3",
    );
  });

  describe("load errors", () => {
    test("the host not signed in to GitHub says how to fix it, and Try again asks again", async () => {
      await mount(
        hostError(
          503,
          "GITHUB_NOT_CONNECTED",
          "The host is not signed in to GitHub: run gh auth login",
        ),
      );
      const error = screen.getByTestId("pull-request-view-error");
      expect(error.getAttribute("data-code")).toBe("GITHUB_NOT_CONNECTED");
      expect(error.textContent).toContain("The host is not connected to GitHub");
      expect(error.textContent).toContain("gh auth login");

      answerPullRequests(host, { detail: makeDetail() });
      await click(screen.getByTestId("pull-request-view-retry"));
      expect(screen.getByTestId("pr-title")).toBeTruthy();
    });

    test("a queued check is counted apart from one in progress", async () => {
      expect(
        checkCounts({
          state: "pending",
          total: 3,
          successful: 1,
          failing: 0,
          pending: 2,
          skipped: 0,
          items: [
            makeCheck({ status: "queued" }),
            makeCheck({ status: "in_progress" }),
            makeCheck(),
          ],
        }),
      ).toBe("1 in progress, 1 queued, 1 successful checks");
    });

    test("a pull request GitHub does not have", async () => {
      await mount(hostError(404, "PULL_REQUEST_NOT_FOUND", "acme/app has no pull request #752"));
      expect(screen.getByTestId("pull-request-view-error").textContent).toContain(
        "Pull request not found",
      );
    });
  });

  describe("the merge box", () => {
    test("ready: a green merge button with the methods the rules allow", async () => {
      await mount();
      expect(screen.getByTestId("pr-merge-box").getAttribute("data-status")).toBe("ready");
      expect(screen.getByTestId("pr-merge-conflicts").textContent).toContain(
        "No conflicts with base branch",
      );
      const merge = screen.getByTestId("pr-merge") as HTMLButtonElement;
      expect(merge.disabled).toBe(false);
      expect(merge.textContent).toBe("Squash and merge");
    });

    test("blocked: every reason is listed and the merge button stays disabled", async () => {
      await mount(
        makeDetail({
          checks: {
            state: "failure",
            total: 1,
            successful: 0,
            failing: 1,
            pending: 0,
            skipped: 0,
            items: [makeCheck({ status: "failure" })],
          },
          merge: {
            status: "blocked",
            conflicts: "conflicting",
            blockers: [
              {
                kind: "conflicts",
                title: "This branch has conflicts that must be resolved",
                detail: null,
              },
              {
                kind: "changes_requested",
                title: "Changes requested",
                detail: "A reviewer asked for changes.",
              },
              { kind: "checks_failing", title: "1 required check failed", detail: "build / test" },
              {
                kind: "checks_missing",
                title: "1 required check expected",
                detail: "Waiting for status to be reported: ci",
              },
            ],
            warnings: ["1 check failed: build / lint"],
            methods: ["squash"],
            missingRequiredChecks: ["ci"],
          },
        }),
      );
      expect(screen.getByTestId("pr-merge-box").getAttribute("data-status")).toBe("blocked");
      expect(screen.getByTestId("pr-merge-conflicts").getAttribute("data-conflicts")).toBe(
        "conflicting",
      );
      expect(
        screen.getAllByTestId("pr-merge-blocker").map((item) => item.getAttribute("data-kind")),
      ).toEqual(["changes_requested", "checks_failing", "checks_missing"]);
      expect(screen.getByTestId("pr-merge-warnings").textContent).toContain("build / lint");
      expect(screen.getByTestId("pr-merge-checks").textContent).toContain(
        "Some checks were not successful",
      );
      expect((screen.getByTestId("pr-merge") as HTMLButtonElement).disabled).toBe(true);
    });

    test("merged and closed pull requests say so; a closed one can be reopened", async () => {
      await mount(
        makeDetail({ state: "merged", merge: { ...makeDetail().merge, status: "done" } }),
      );
      expect(screen.getByTestId("pr-merge-box").textContent).toContain(
        "Pull request successfully merged and closed",
      );
      expect(screen.getByTestId("pr-state-badge").getAttribute("data-state")).toBe("merged");
      cleanup();

      await mount(
        makeDetail({ state: "closed", merge: { ...makeDetail().merge, status: "done" } }),
      );
      expect(screen.getByTestId("pr-merge-box").textContent).toContain(
        "Closed with unmerged commits",
      );
      await click(screen.getByTestId("pr-reopen"));
      expect(writes().map((request) => [request.method, request.body])).toEqual([
        ["PATCH", { state: "open" }],
      ]);
    });
  });

  describe("as a client that may only read", () => {
    test("no buttons that change the pull request, and the reason why", async () => {
      await mount(
        makeDetail({
          viewer: {
            canWrite: false,
            readOnlyReason:
              "This device can read pull requests; only the host machine's owner can act on them.",
            login: "owner",
          },
        }),
      );
      for (const id of [
        "pr-merge",
        "pr-comment-box",
        "pr-title-edit",
        "pr-state-menu",
        "pr-convert-draft",
      ]) {
        expect({ id, shown: screen.queryByTestId(id) !== null }).toEqual({ id, shown: false });
      }
      expect(screen.getByTestId("pr-merge-read-only").textContent).toContain(
        "only the host machine's owner",
      );
      // Reading and asking stay open to every client.
      expect(screen.getByTestId("pr-refresh")).toBeTruthy();
      expect(screen.getByTestId("pr-ask-coordinator")).toBeTruthy();
    });
  });

  describe("actions of the host owner", () => {
    test("comment, approve and request changes post to the host, then the page reads again", async () => {
      await mount();
      const input = screen.getByTestId("pr-comment-input");
      fireEvent.change(input, { target: { value: "Ship it" } });
      await click(screen.getByTestId("pr-comment-submit"));
      fireEvent.change(input, { target: { value: "Cap the backoff" } });
      await click(screen.getByTestId("pr-request-changes"));
      await click(screen.getByTestId("pr-approve"));

      expect(
        writes().map((request) => [
          request.method,
          request.url.replace(/.*\/pulls\/752/, ""),
          request.body,
        ]),
      ).toEqual([
        ["POST", "/comments", { body: "Ship it" }],
        ["POST", "/reviews", { event: "REQUEST_CHANGES", body: "Cap the backoff" }],
        ["POST", "/reviews", { event: "APPROVE", body: "" }],
      ]);
      expect(host.to(`${PULL}?refresh=1`)).toHaveLength(3);
      expect((input as HTMLTextAreaElement).value).toBe("");
    });

    test("the author of the pull request gets no approve or request changes, as on GitHub", async () => {
      await mount(makeDetail({ author: { login: "owner", avatarUrl: null } }));
      expect(screen.queryByTestId("pr-approve")).toBeNull();
      expect(screen.getByTestId("pr-comment-box").textContent).toContain(
        "does not let the author approve",
      );
    });

    test("merge asks first, then merges with the chosen method and the head the person saw", async () => {
      await mount();
      await click(screen.getByTestId("pr-merge"));
      expect(writes()).toEqual([]);
      await confirm();
      expect(writes().map((request) => request.body)).toEqual([
        { method: "squash", expectedHeadSha: "a".repeat(40) },
      ]);
    });

    test("a merge GitHub refuses leaves the pull request open and says why", async () => {
      answerPullRequests(host, {
        detail: makeDetail(),
        refuse: {
          "POST /merge": hostError(
            422,
            "GITHUB_REFUSED",
            'GitHub refused: Required status check "ci" is expected.',
          ),
        },
      });
      render(
        <>
          <ConfirmationHost />
          <PullRequestView
            entry={makeEntry(project)}
            pullRequest={{ repoId: "repo_1", number: 752 }}
            onAsk={mock()}
          />
        </>,
      );
      await settle();
      await click(screen.getByTestId("pr-merge"));
      await confirm();
      expect(writes()).toHaveLength(1);
      expect(screen.getByTestId("pr-state-badge").getAttribute("data-state")).toBe("open");
    });

    test("rename the title in place; Escape cancels without closing anything", async () => {
      await mount();
      await click(screen.getByTestId("pr-title-edit"));
      const input = screen.getByTestId("pr-title-input");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByTestId("pr-title-input")).toBeNull();

      await click(screen.getByTestId("pr-title-edit"));
      fireEvent.change(screen.getByTestId("pr-title-input"), { target: { value: "Show impacts" } });
      fireEvent.submit(screen.getByTestId("pr-title-form"));
      await settle();
      expect(writes().map((request) => request.body)).toEqual([{ title: "Show impacts" }]);
    });

    test("convert to draft, mark ready, and close (which asks first)", async () => {
      await mount();
      await click(screen.getByTestId("pr-convert-draft"));
      cleanup();
      await mount(makeDetail({ isDraft: true }));
      expect(screen.getByTestId("pr-state-badge").getAttribute("data-state")).toBe("draft");
      await click(screen.getByTestId("pr-ready"));
      expect(writes().map((request) => request.body)).toEqual([{ draft: true }, { draft: false }]);
    });
  });

  test("Ask the coordinator sends the question with the pull request's link", async () => {
    const { onAsk } = await mount();
    await click(screen.getByTestId("pr-ask-coordinator"));
    fireEvent.change(screen.getByTestId("pr-ask-question"), {
      target: { value: "Can this merge today?" },
    });
    await click(screen.getByTestId("pr-ask-send"));
    expect(onAsk).toHaveBeenCalledWith(coordinatorMessage(makeDetail(), "Can this merge today?"));
    expect(coordinatorMessage(makeDetail(), "Can this merge today?")).toBe(
      "Can this merge today?\n\nPull request acme/app#752 “Show monster ability impacts”: https://github.com/acme/app/pull/752",
    );
  });

  test("the suggested question fits the state: what an open one needs, what a done one left", async () => {
    await mount();
    await click(screen.getByTestId("pr-ask-coordinator"));
    expect((screen.getByTestId("pr-ask-question") as HTMLTextAreaElement).value).toBe(
      suggestedQuestion("open"),
    );
    cleanup();

    await mount(makeDetail({ state: "merged", merge: { ...makeDetail().merge, status: "done" } }));
    await click(screen.getByTestId("pr-ask-coordinator"));
    expect((screen.getByTestId("pr-ask-question") as HTMLTextAreaElement).value).toBe(
      suggestedQuestion("merged"),
    );
    expect(suggestedQuestion("merged")).not.toContain("before it can merge");
  });

  test("the tabs stay on one row and scroll sideways rather than wrap over the content", async () => {
    await mount();
    const tabs = screen.getByTestId("pr-tabs");
    expect(tabs.className).toContain("overflow-x-auto");
    expect(tabs.className).not.toContain("flex-wrap");
  });

  test("Refresh reads GitHub again past the host's cache", async () => {
    await mount();
    await click(screen.getByTestId("pr-refresh"));
    expect(host.to(`${PULL}?refresh=1`)).toHaveLength(1);
  });

  test("a refresh that fails keeps the page and says it may be out of date", async () => {
    await mount();
    host.respondWith(() =>
      hostError(429, "GITHUB_RATE_LIMITED", "GitHub is rate limiting the host's account"),
    );
    await click(screen.getByTestId("pr-refresh"));
    expect(screen.getByTestId("pr-title")).toBeTruthy();
    expect(screen.getByTestId("pull-request-view-stale").textContent).toContain("rate limiting");
  });
});
