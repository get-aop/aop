import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Thread, ThreadStatus } from "@aop/common";
import { setupDashboardDom } from "../test/setup-dom";
import type { ProjectEntry } from "./projects-state";
import { makeEntry, makeProject, makeThread } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ThreadOverview } = await import("./ThreadOverview");

afterEach(cleanup);
beforeEach(() => window.history.pushState({}, "", "/"));

const project = makeProject({ id: "p1" });
const entryOf = (threads: Thread[], overrides: Partial<ProjectEntry> = {}) =>
  makeEntry(project, threads, overrides);

const ALL_STATUSES: ThreadStatus[] = [
  "resolved",
  "idle",
  "landing",
  "ready-for-review",
  "rate-limited",
  "queued",
  "working",
  "waiting-on-you",
];

const onePerStatus = () =>
  ALL_STATUSES.map((status) =>
    makeThread({ id: status, projectId: "p1", title: `Thread ${status}`, status }),
  );

const groups = () => screen.getAllByTestId("thread-group");
const groupOf = (status: ThreadStatus) =>
  groups().find((group) => group.getAttribute("data-status") === status) as HTMLElement;
const titlesIn = (group: HTMLElement) =>
  within(group)
    .queryAllByTestId("thread-card-link")
    .map((link) => link.textContent);
const counter = (name: string) =>
  screen.getByTestId("overview-counters").querySelector(`[data-counter="${name}"]`) as HTMLElement;

describe("the groups", () => {
  test("come in the order a person should look at them, whatever order the threads arrive in", () => {
    render(<ThreadOverview entry={entryOf(onePerStatus())} />);

    expect(groups().map((group) => group.getAttribute("data-status"))).toEqual([
      "waiting-on-you",
      "working",
      "queued",
      "rate-limited",
      "ready-for-review",
      "landing",
      "idle",
      "resolved",
    ]);
  });

  test("a status with no thread has no group", () => {
    render(
      <ThreadOverview
        entry={entryOf([
          makeThread({ id: "a", status: "working" }),
          makeThread({ id: "b", status: "idle" }),
        ])}
      />,
    );

    expect(groups().map((group) => group.getAttribute("data-status"))).toEqual(["working", "idle"]);
  });

  test("each group counts its threads and the newest activity leads", () => {
    render(
      <ThreadOverview
        entry={entryOf([
          makeThread({
            id: "old",
            title: "Old work",
            status: "working",
            lastActivityAt: "2026-09-29T09:00:00.000Z",
          }),
          makeThread({
            id: "new",
            title: "New work",
            status: "working",
            lastActivityAt: "2026-09-29T11:00:00.000Z",
          }),
          makeThread({ id: "mid", title: "Idle one", status: "idle" }),
        ])}
      />,
    );

    const working = groupOf("working");
    expect(within(working).getByTestId("thread-group-count").textContent).toBe("2");
    expect(titlesIn(working)).toEqual(["New work", "Old work"]);
    expect(within(groupOf("idle")).getByTestId("thread-group-count").textContent).toBe("1");
  });

  test("every card opens its thread", () => {
    render(
      <ThreadOverview
        entry={entryOf([makeThread({ id: "t 1", projectId: "p1", title: "Fix it" })])}
      />,
    );

    const link = screen.getByTestId("thread-card-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/projects/p1/threads/t%201");
    fireEvent.click(link);
    expect(window.location.pathname).toBe("/projects/p1/threads/t%201");
  });
});

describe("folding", () => {
  test("resolved work starts folded away and opens when asked for; the rest starts open", () => {
    render(<ThreadOverview entry={entryOf(onePerStatus())} />);

    const resolved = groupOf("resolved");
    expect(resolved.getAttribute("data-open")).toBe("false");
    expect(titlesIn(resolved)).toEqual([]);
    expect(groupOf("working").getAttribute("data-open")).toBe("true");
    expect(titlesIn(groupOf("working"))).toEqual(["Thread working"]);

    const toggle = within(resolved).getByTestId("thread-group-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(groupOf("resolved").getAttribute("data-open")).toBe("true");
    expect(titlesIn(groupOf("resolved"))).toEqual(["Thread resolved"]);
  });

  test("an open group folds and opens again", () => {
    render(<ThreadOverview entry={entryOf(onePerStatus())} />);

    fireEvent.click(within(groupOf("idle")).getByTestId("thread-group-toggle"));
    expect(groupOf("idle").getAttribute("data-open")).toBe("false");
    expect(titlesIn(groupOf("idle"))).toEqual([]);
    // The count stays, so a folded group still says how much is in it.
    expect(within(groupOf("idle")).getByTestId("thread-group-count").textContent).toBe("1");

    fireEvent.click(within(groupOf("idle")).getByTestId("thread-group-toggle"));
    expect(titlesIn(groupOf("idle"))).toEqual(["Thread idle"]);
  });
});

describe("search", () => {
  const search = (query: string) =>
    fireEvent.change(screen.getByTestId("thread-search"), { target: { value: query } });

  test("filters the threads, opens every group so a match is never hidden, and says how many match", () => {
    render(<ThreadOverview entry={entryOf(onePerStatus())} />);

    search("resolved");

    expect(groups().map((group) => group.getAttribute("data-status"))).toEqual(["resolved"]);
    expect(groupOf("resolved").getAttribute("data-open")).toBe("true");
    expect(titlesIn(groupOf("resolved"))).toEqual(["Thread resolved"]);
    expect(screen.getByTestId("thread-count").textContent).toBe("1 of 8");
  });

  test("clearing the search brings back the groups as they were", () => {
    render(<ThreadOverview entry={entryOf(onePerStatus())} />);

    search("resolved");
    search("");

    expect(groups()).toHaveLength(8);
    expect(groupOf("resolved").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("thread-count").textContent).toBe("8 threads");
  });

  test("says when nothing matches and draws no group", () => {
    render(<ThreadOverview entry={entryOf(onePerStatus())} />);

    search("zzz");

    expect(screen.getByTestId("threads-no-match").textContent).toContain("zzz");
    expect(screen.queryByTestId("thread-group")).toBeNull();
    expect(screen.queryByTestId("thread-groups")).toBeNull();
  });
});

describe("counters", () => {
  const pr = (state: "open" | "merged" | "closed", number: number) =>
    ({
      type: "pr",
      number,
      url: `https://github.com/acme/app/pull/${number}`,
      state,
    }) as const;

  const threads = () => [
    makeThread({ id: "q1", status: "waiting-on-you" }),
    makeThread({ id: "q2", status: "waiting-on-you" }),
    makeThread({ id: "w1", status: "working" }),
    makeThread({ id: "w2", status: "queued" }),
    makeThread({ id: "w3", status: "rate-limited" }),
    makeThread({ id: "r1", status: "ready-for-review", artifacts: [pr("open", 1)] }),
    makeThread({ id: "l1", status: "landing", artifacts: [pr("open", 2)] }),
    makeThread({ id: "d1", status: "resolved", artifacts: [pr("merged", 3)] }),
    makeThread({
      id: "d2",
      status: "idle",
      artifacts: [pr("closed", 4), { type: "doc", name: "N" }],
    }),
  ];

  test("count what needs the person, what runs, what waits for review, open pull requests and what is done", () => {
    render(<ThreadOverview entry={entryOf(threads())} />);

    const values = Object.fromEntries(
      ["waiting", "running", "readyForReview", "openPullRequests", "resolved"].map((name) => [
        name,
        counter(name).getAttribute("data-value"),
      ]),
    );
    // Running is working, queued and rate-limited; only open pull requests count as open.
    expect(values).toEqual({
      waiting: "2",
      running: "3",
      readyForReview: "1",
      openPullRequests: "2",
      resolved: "1",
    });
    expect(counter("waiting").textContent).toContain("Waiting on you");
    expect(counter("waiting").textContent).toContain("2");
  });

  test("follow the threads as the stream changes them", () => {
    const { rerender } = render(<ThreadOverview entry={entryOf(threads())} />);
    expect(counter("waiting").getAttribute("data-value")).toBe("2");

    rerender(
      <ThreadOverview
        entry={entryOf(
          threads().map((thread) =>
            thread.id === "q1" ? makeThread({ id: "q1", status: "working" }) : thread,
          ),
        )}
      />,
    );

    expect(counter("waiting").getAttribute("data-value")).toBe("1");
    expect(counter("running").getAttribute("data-value")).toBe("4");
  });

  test("count the project's threads, not only the ones a search shows", () => {
    render(<ThreadOverview entry={entryOf(threads())} />);

    fireEvent.change(screen.getByTestId("thread-search"), {
      target: { value: "nothing like this" },
    });

    expect(counter("waiting").getAttribute("data-value")).toBe("2");
  });
});

describe("before there is anything to group", () => {
  test("says it is loading while the threads are fetched", () => {
    render(<ThreadOverview entry={entryOf([], { threadsLoaded: false })} />);

    expect(screen.getByTestId("threads-loading")).toBeTruthy();
    expect(screen.queryByTestId("overview-counters")).toBeNull();
  });

  test("a project with no threads points at the coordinator", () => {
    render(<ThreadOverview entry={entryOf([])} />);

    expect(screen.getByTestId("threads-empty")).toBeTruthy();
    expect(screen.queryByTestId("thread-groups")).toBeNull();
    fireEvent.click(screen.getByTestId("threads-empty-chat"));
    expect(window.location.pathname).toBe("/projects/p1/chat");
  });
});
