import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Thread } from "@aop/common";
import { toast } from "sonner";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";
import { hostError, json, mockHost } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { PullRequestBar, PullRequestProblemNotice } = await import("./PullRequestBar");
const { usePullRequestControls } = await import("./use-pull-request");

const PR_URL = "https://github.com/acme/app/pull/7";
const OPEN_PR = { type: "pr" as const, number: 7, url: PR_URL, state: "open" as const };

const withPullRequest = (state: "open" | "merged" | "closed", status: Thread["status"]) =>
  makeThread({ id: "thr_1", status, artifacts: [{ ...OPEN_PR, state }] });

/** The bar and its notice sharing one set of controls, as the pane wires them. */
const Harness = ({ thread, changedFiles = 3 }: { thread: Thread; changedFiles?: number }) => {
  const controls = usePullRequestControls(thread.id);
  return (
    <>
      <PullRequestBar thread={thread} controls={controls} changedFiles={changedFiles} />
      <PullRequestProblemNotice controls={controls} />
    </>
  );
};

/** The bar on its own, to see what it asks of its holder. */
const Bare = ({
  thread,
  onHide = () => {},
  onToggleChanges = () => {},
  changesOpen = false,
}: {
  thread: Thread;
  onHide?: () => void;
  onToggleChanges?: () => void;
  changesOpen?: boolean;
}) => {
  const controls = usePullRequestControls(thread.id);
  return (
    <PullRequestBar
      thread={thread}
      controls={controls}
      changedFiles={3}
      changesOpen={changesOpen}
      onToggleChanges={onToggleChanges}
      onHide={onHide}
    />
  );
};

let host: ReturnType<typeof mockHost>;
let success: ReturnType<typeof spyOn<typeof toast, "success">>;

beforeEach(() => {
  host = mockHost();
  success = spyOn(toast, "success").mockImplementation(() => "");
});

afterEach(() => {
  cleanup();
  host.restore();
  success.mockRestore();
});

const BRANCH = "aop/fix-the-login-redirect-a1b2c3";
const idle = () => makeThread({ id: "thr_1", status: "idle", branch: BRANCH });
const opened = (created = true) => json({ thread: idle(), pullRequest: OPEN_PR, created });
const click = (testId: string) => fireEvent.click(screen.getByTestId(testId));
const openMenu = async (testId: string, menuTestId: string) => {
  fireEvent.pointerDown(screen.getByTestId(testId), { button: 0, ctrlKey: false });
  await screen.findByTestId(menuTestId);
};

/** A host answer the test releases by hand, to look at the page while a call is in flight. */
const held = () => {
  let release: (response: Response) => void = () => {};
  const answer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { answer, release };
};

describe("a thread with no pull request", () => {
  test("shows the branch and opens one with an empty body, then reports it", async () => {
    host.respondWith(() => opened());
    render(<Harness thread={idle()} />);

    expect(screen.getByTestId("pr-bar").getAttribute("data-state")).toBe("none");
    expect(screen.getByTestId("thread-branch").textContent).toBe(BRANCH);
    expect(screen.getByTestId("thread-branch").getAttribute("title")).toBe(BRANCH);
    expect(screen.getByTestId("pr-open").textContent).toContain("Create PR");
    expect(screen.queryByTestId("pr-merge")).toBeNull();

    click("pr-open");

    await waitFor(() => expect(success).toHaveBeenCalledWith("Opened pull request #7"));
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr_1/pull-request", body: {} },
    ]);
  });

  test("has no bar when the thread changed nothing", () => {
    render(<Harness thread={idle()} changedFiles={0} />);

    expect(screen.queryByTestId("pr-bar")).toBeNull();
  });

  test("has no bar while the thread waits out a rate limit with nothing published", () => {
    render(
      <Harness thread={makeThread({ id: "thr_1", status: "rate-limited", branch: BRANCH })} />,
    );

    expect(screen.queryByTestId("pr-bar")).toBeNull();
  });

  test("keeps the bar of a rate-limited thread whose pull request is already open", () => {
    render(
      <Harness
        thread={makeThread({ id: "thr_1", status: "rate-limited", artifacts: [OPEN_PR] })}
        changedFiles={0}
      />,
    );

    expect(screen.getByTestId("pr-bar").getAttribute("data-state")).toBe("open");
  });

  test("says how many files changed, and the link opens and closes them", () => {
    const toggle = mock();
    const { rerender } = render(<Bare thread={idle()} onToggleChanges={toggle} />);

    const link = screen.getByTestId("pr-bar-changes");
    expect(link.textContent).toBe("3 files changed");
    expect(link.getAttribute("aria-pressed")).toBe("false");
    click("pr-bar-changes");
    expect(toggle).toHaveBeenCalledTimes(1);

    rerender(<Bare thread={idle()} onToggleChanges={toggle} changesOpen />);
    expect(screen.getByTestId("pr-bar-changes").getAttribute("aria-pressed")).toBe("true");
  });

  test("the cross puts the bar away for the thread, and only while there is no pull request", () => {
    const hide = mock();
    const { rerender } = render(<Bare thread={idle()} onHide={hide} />);

    click("pr-bar-hide");
    expect(hide).toHaveBeenCalledTimes(1);

    rerender(<Bare thread={withPullRequest("open", "ready-for-review")} onHide={hide} />);
    expect(screen.queryByTestId("pr-bar-hide")).toBeNull();
  });

  test("is one slim row of secondary controls, never a filled white button", () => {
    render(<Bare thread={idle()} />);

    const bar = screen.getByTestId("pr-bar");
    expect(bar.className).toContain("h-8");
    expect(bar.className).not.toContain("flex-wrap");
    const open = screen.getByTestId("pr-open");
    expect(open.getAttribute("data-variant")).toBe("secondary");
    expect(open.className).toContain("h-6");
    expect(screen.getByTestId("pr-open-menu").getAttribute("data-variant")).toBe("secondary");
  });

  test("opens it as a draft from the menu", async () => {
    host.respondWith(() => opened());
    render(<Harness thread={idle()} />);

    await openMenu("pr-open-menu", "pr-open-draft");
    fireEvent.click(screen.getByTestId("pr-open-draft"));

    await waitFor(() => expect(host.requests).toHaveLength(1));
    expect(host.requests[0]).toEqual({
      method: "POST",
      url: "/api/threads/thr_1/pull-request",
      body: { draft: true },
    });
  });
});

describe("a thread with an open pull request", () => {
  test("shows 'PR #7' as a link to the pull request, the branch giving way to it", () => {
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);

    const chip = screen.getByTestId("pr-bar-chip");
    expect(chip.getAttribute("href")).toBe(PR_URL);
    expect(chip.getAttribute("data-state")).toBe("open");
    expect(chip.textContent).toBe("PR #7");
    // An open one's colour says it is open; the word is kept for merged and closed.
    expect(screen.queryByTestId("pr-bar-state")).toBeNull();
    expect(screen.queryByTestId("thread-branch")).toBeNull();
    expect(screen.getByTestId("pr-bar").getAttribute("data-state")).toBe("open");
    expect(screen.queryByTestId("pr-open")).toBeNull();
  });

  test("says in words what its checks add up to, when the host has read them", () => {
    const withChecks = (checks: {
      state: "pending" | "success" | "failure";
      successful: number;
      failing: number;
      pending: number;
    }) =>
      makeThread({
        id: "thr_1",
        status: "ready-for-review",
        artifacts: [{ ...OPEN_PR, checks }],
      });

    const { rerender } = render(<Harness thread={withPullRequest("open", "ready-for-review")} />);
    expect(screen.queryByTestId("pr-bar-checks")).toBeNull();

    rerender(
      <Harness thread={withChecks({ state: "failure", successful: 1, failing: 2, pending: 0 })} />,
    );
    // Secondary text in the bar is the readable grey, not the faint one.
    expect(screen.getByTestId("pr-bar-summary").className).toContain("text-text-muted");
    expect(screen.getByTestId("pr-bar-checks").textContent).toBe("2 checks failing");
    expect(screen.getByTestId("pr-bar-chip").getAttribute("data-checks")).toBe("failure");

    rerender(
      <Harness thread={withChecks({ state: "pending", successful: 0, failing: 0, pending: 1 })} />,
    );
    expect(screen.getByTestId("pr-bar-checks").textContent).toBe("1 check running");

    rerender(
      <Harness thread={withChecks({ state: "success", successful: 3, failing: 0, pending: 0 })} />,
    );
    expect(screen.getByTestId("pr-bar-checks").textContent).toBe("All checks passed");
  });

  test("Sync asks the host to bring the thread in line with GitHub", async () => {
    host.respondWith(() => json({ thread: idle() }));
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);

    click("pr-sync");

    await waitFor(() => expect(success).toHaveBeenCalledWith("In step with GitHub"));
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr_1/pull-request/sync", body: undefined },
    ]);
  });

  test("Merge squashes by default", async () => {
    host.respondWith(() => json({ thread: idle() }));
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);
    expect(screen.getByTestId("pr-merge").getAttribute("data-method")).toBe("squash");

    click("pr-merge");

    await waitFor(() => expect(success).toHaveBeenCalledWith("Merged the pull request"));
    expect(host.requests).toEqual([
      {
        method: "POST",
        url: "/api/threads/thr_1/pull-request/merge",
        body: { method: "squash" },
      },
    ]);
  });

  test("the method menu changes what the next click sends", async () => {
    host.respondWith(() => json({ thread: idle() }));
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);

    await openMenu("pr-merge-menu", "pr-merge-methods");
    fireEvent.click(screen.getByTestId("pr-merge-rebase"));
    expect(screen.getByTestId("pr-merge").getAttribute("data-method")).toBe("rebase");
    click("pr-merge");
    await waitFor(() => expect(host.requests).toHaveLength(1));

    await waitFor(() => expect(screen.queryByTestId("pr-merge-methods")).toBeNull());
    await openMenu("pr-merge-menu", "pr-merge-methods");
    fireEvent.click(screen.getByTestId("pr-merge-merge"));
    await waitFor(() =>
      expect(screen.getByTestId("pr-merge").getAttribute("data-method")).toBe("merge"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("pr-merge").hasAttribute("disabled")).toBe(false),
    );
    click("pr-merge");

    await waitFor(() => expect(host.requests).toHaveLength(2));
    expect(host.requests.map((request) => request.body)).toEqual([
      { method: "rebase" },
      { method: "merge" },
    ]);
  });
});

describe("a pull request that is done", () => {
  test("a merged one shows its chip and offers nothing more", () => {
    render(<Harness thread={withPullRequest("merged", "resolved")} />);

    expect(screen.getByTestId("pr-bar-chip").getAttribute("data-state")).toBe("merged");
    expect(screen.getByTestId("pr-bar-state").textContent).toBe("Merged");
    for (const id of ["pr-open", "pr-sync", "pr-merge", "pr-merge-menu"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  test("a closed one can only be synced: it cannot be merged", () => {
    render(<Harness thread={withPullRequest("closed", "idle")} />);

    expect(screen.getByTestId("pr-bar-chip").getAttribute("data-state")).toBe("closed");
    expect(screen.getByTestId("pr-bar-state").textContent).toBe("Closed");
    expect(screen.getByTestId("pr-sync")).toBeTruthy();
    expect(screen.queryByTestId("pr-merge")).toBeNull();
    expect(screen.queryByTestId("pr-open")).toBeNull();
  });

  test("a merge in progress says so and takes no action", () => {
    render(<Harness thread={makeThread({ id: "thr_1", status: "landing" })} />);

    expect(screen.getByTestId("pr-bar-summary").textContent).toContain("Merging");
    expect(screen.getByTestId("pr-bar-chip").textContent).toContain("#7");
    for (const id of ["pr-open", "pr-sync", "pr-merge"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });
});

describe("while a call is in flight", () => {
  test("Open shows its progress and every control waits for the answer", async () => {
    const call = held();
    host.respondWith(() => call.answer);
    render(<Harness thread={idle()} />);

    click("pr-open");

    await waitFor(() => expect(screen.getByTestId("pr-open").textContent).toContain("Creating…"));
    expect(screen.getByTestId("pr-open").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("pr-open-menu").hasAttribute("disabled")).toBe(true);

    await act(async () => call.release(opened()));

    await waitFor(() => expect(screen.getByTestId("pr-open").textContent).toContain("Create PR"));
    expect(screen.getByTestId("pr-open").hasAttribute("disabled")).toBe(false);
  });

  // Sync is an icon: what it says is its accessible name.
  const said = (testId: string) => {
    const control = screen.getByTestId(testId);
    return control.getAttribute("aria-label") ?? control.textContent ?? "";
  };

  test.each([
    ["pr-merge", "Merging…", "Merge"],
    ["pr-sync", "Syncing with GitHub", "Sync with GitHub"],
  ])("%s shows %s and disables the other controls", async (testId, busyLabel, idleLabel) => {
    const call = held();
    host.respondWith(() => call.answer);
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);

    click(testId);

    await waitFor(() => expect(said(testId)).toContain(busyLabel));
    for (const id of ["pr-sync", "pr-merge", "pr-merge-menu"]) {
      expect(screen.getByTestId(id).hasAttribute("disabled")).toBe(true);
    }

    await act(async () => call.release(json({ thread: idle() })));

    await waitFor(() => expect(said(testId)).toContain(idleLabel));
    for (const id of ["pr-sync", "pr-merge", "pr-merge-menu"]) {
      expect(screen.getByTestId(id).hasAttribute("disabled")).toBe(false);
    }
  });
});

describe("what the host refuses", () => {
  const SENTENCES = {
    UNPUBLISHED_WORK:
      "The thread has work its pull request does not include; open the pull request again to push it, then merge",
    PULL_REQUEST_MERGED:
      "The thread's pull request already merged; start a new thread for further work",
    NOTHING_TO_PUBLISH: "The thread has no changes to open a pull request for",
    THREAD_BUSY: "The thread is busy: a turn is running, queued or waiting on a usage limit",
  } as const;

  const refuse = (code: keyof typeof SENTENCES) =>
    host.respondWith(() => hostError(409, code, SENTENCES[code]));

  test.each([
    ["UNPUBLISHED_WORK", "pr-merge", "The pull request was not merged.", true, false],
    ["PULL_REQUEST_MERGED", "pr-open", "The pull request was not opened.", false, true],
    ["NOTHING_TO_PUBLISH", "pr-open", "The pull request was not opened.", false, false],
    ["THREAD_BUSY", "pr-sync", "The pull request was not synced.", false, false],
  ] as const)(
    "%s is shown as the host words it, with its code, and only the fixable ones get a button",
    async (code, action, headline, canPush, canSync) => {
      refuse(code);
      const thread = action === "pr-open" ? idle() : withPullRequest("open", "ready-for-review");
      render(<Harness thread={thread} />);

      click(action);

      const notice = await screen.findByTestId("pr-error");
      expect(notice.getAttribute("role")).toBe("alert");
      expect(notice.getAttribute("data-code")).toBe(code);
      expect(screen.getByTestId("pr-error-message").textContent).toBe(SENTENCES[code]);
      expect(screen.getByTestId("pr-error-code").textContent).toBe(code);
      expect(notice.textContent).toContain(headline);
      expect(screen.queryByTestId("pr-push-latest") !== null).toBe(canPush);
      expect(screen.queryByTestId("pr-sync-after-error") !== null).toBe(canSync);
      expect(success).not.toHaveBeenCalled();
    },
  );

  test("Push the latest changes opens again, and success clears the refusal", async () => {
    refuse("UNPUBLISHED_WORK");
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);
    click("pr-merge");
    await screen.findByTestId("pr-push-latest");

    host.respondWith(() => opened(false));
    click("pr-push-latest");

    await waitFor(() => expect(screen.queryByTestId("pr-error")).toBeNull());
    expect(success).toHaveBeenCalledWith("Pushed the latest changes to #7");
    expect(host.requests.at(-1)).toEqual({
      method: "POST",
      url: "/api/threads/thr_1/pull-request",
      body: {},
    });
  });

  test("Sync with GitHub asks the host to reconcile, and success clears the refusal", async () => {
    refuse("PULL_REQUEST_MERGED");
    render(<Harness thread={idle()} />);
    click("pr-open");
    await screen.findByTestId("pr-sync-after-error");

    host.respondWith(() => json({ thread: idle() }));
    click("pr-sync-after-error");

    await waitFor(() => expect(screen.queryByTestId("pr-error")).toBeNull());
    expect(host.requests.at(-1)).toEqual({
      method: "POST",
      url: "/api/threads/thr_1/pull-request/sync",
      body: undefined,
    });
  });

  test("the notice stays until it is dismissed, and dismissing clears only it", async () => {
    refuse("THREAD_BUSY");
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);
    click("pr-merge");
    await screen.findByTestId("pr-error");

    fireEvent.click(screen.getByTestId("pr-error-dismiss"));

    expect(screen.queryByTestId("pr-error")).toBeNull();
    expect(screen.getByTestId("pr-merge")).toBeTruthy();
  });

  test("a new attempt clears the earlier refusal while it runs", async () => {
    refuse("THREAD_BUSY");
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);
    click("pr-merge");
    await screen.findByTestId("pr-error");

    const call = held();
    host.respondWith(() => call.answer);
    click("pr-sync");

    await waitFor(() => expect(screen.queryByTestId("pr-error")).toBeNull());
    await act(async () => call.release(json({ thread: idle() })));
  });

  test("a host that cannot be reached shows UNKNOWN and what the browser said", async () => {
    host.respondWith(() => {
      throw new TypeError("Failed to fetch");
    });
    render(<Harness thread={idle()} />);

    click("pr-open");

    const notice = await screen.findByTestId("pr-error");
    expect(notice.getAttribute("data-code")).toBe("UNKNOWN");
    expect(screen.getByTestId("pr-error-message").textContent).toBe("Failed to fetch");
    expect(screen.getByTestId("pr-open").hasAttribute("disabled")).toBe(false);
  });
});
