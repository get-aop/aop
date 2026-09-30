import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
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
const Harness = ({ thread }: { thread: Thread }) => {
  const controls = usePullRequestControls(thread.id);
  return (
    <>
      <PullRequestBar thread={thread} controls={controls} />
      <PullRequestProblemNotice controls={controls} />
    </>
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

const idle = () => makeThread({ id: "thr_1", status: "idle" });
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
  test("says so and opens one with an empty body, then reports it", async () => {
    host.respondWith(() => opened());
    render(<Harness thread={idle()} />);

    expect(screen.getByTestId("pr-bar").getAttribute("data-state")).toBe("none");
    expect(screen.getByTestId("pr-bar-summary").textContent).toContain("No pull request");
    expect(screen.queryByTestId("pr-merge")).toBeNull();

    click("pr-open");

    await waitFor(() => expect(success).toHaveBeenCalledWith("Opened pull request #7"));
    expect(host.requests).toEqual([
      { method: "POST", url: "/api/threads/thr_1/pull-request", body: {} },
    ]);
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
  test("shows the chip as a link to the pull request, with its state in words", () => {
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);

    const chip = screen.getByTestId("pr-bar-chip");
    expect(chip.getAttribute("href")).toBe(PR_URL);
    expect(chip.getAttribute("data-state")).toBe("open");
    expect(chip.textContent).toContain("#7");
    expect(screen.getByTestId("pr-bar-state").textContent).toBe("Open");
    expect(screen.getByTestId("pr-bar").getAttribute("data-state")).toBe("open");
    expect(screen.queryByTestId("pr-open")).toBeNull();
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

    await waitFor(() => expect(screen.getByTestId("pr-open").textContent).toContain("Opening…"));
    expect(screen.getByTestId("pr-open").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("pr-open-menu").hasAttribute("disabled")).toBe(true);

    await act(async () => call.release(opened()));

    await waitFor(() =>
      expect(screen.getByTestId("pr-open").textContent).toContain("Open pull request"),
    );
    expect(screen.getByTestId("pr-open").hasAttribute("disabled")).toBe(false);
  });

  test.each([
    ["pr-merge", "Merging…", "Merge"],
    ["pr-sync", "Syncing…", "Sync"],
  ])("%s shows %s and disables the other controls", async (testId, busyLabel, idleLabel) => {
    const call = held();
    host.respondWith(() => call.answer);
    render(<Harness thread={withPullRequest("open", "ready-for-review")} />);

    click(testId);

    await waitFor(() => expect(screen.getByTestId(testId).textContent).toContain(busyLabel));
    for (const id of ["pr-sync", "pr-merge", "pr-merge-menu"]) {
      expect(screen.getByTestId(id).hasAttribute("disabled")).toBe(true);
    }

    await act(async () => call.release(json({ thread: idle() })));

    await waitFor(() => expect(screen.getByTestId(testId).textContent).toContain(idleLabel));
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
