import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Thread, ThreadStatus } from "@aop/common";
import { useEffect } from "react";
import { setupDashboardDom } from "../test/setup-dom";
import type { ProjectEntry } from "./projects-state";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ThreadOverview } = await import("./ThreadOverview");
const { useOverviewFilters } = await import("./layout/use-overview-filters");
const { ProjectsProvider } = await import("./ProjectsProvider");

afterEach(cleanup);
beforeEach(() => window.history.pushState({}, "", "/"));

// The overview as the panel holds it: its search box open, and the filters it is handed.
const NO_FILTER: ThreadStatus[] = [];
const Overview = ({ entry, hide = NO_FILTER }: { entry: ProjectEntry; hide?: ThreadStatus[] }) => {
  const filters = useOverviewFilters();
  const { toggleSearch, toggleStatus } = filters;
  useEffect(() => {
    toggleSearch();
    for (const status of hide) toggleStatus(status);
  }, [toggleSearch, toggleStatus, hide]);
  return <ThreadOverview entry={entry} filters={filters} />;
};

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
describe("the groups", () => {
  test("come in the order a person should look at them, whatever order the threads arrive in", () => {
    render(<Overview entry={entryOf(onePerStatus())} />);

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

  test("Waiting on you and Resolved are always there; any other status only with a thread in it", () => {
    render(
      <Overview
        entry={entryOf([
          makeThread({ id: "a", status: "working" }),
          makeThread({ id: "b", status: "idle" }),
        ])}
      />,
    );

    expect(groups().map((group) => group.getAttribute("data-status"))).toEqual([
      "waiting-on-you",
      "working",
      "idle",
      "resolved",
    ]);
  });

  test("an empty one says what goes in it, has nothing to fold, and counts 0", () => {
    render(<Overview entry={entryOf([makeThread({ id: "b", status: "idle" })])} />);

    const waiting = groupOf("waiting-on-you");
    expect(within(waiting).getByTestId("thread-group-count").textContent).toBe("0");
    expect(within(waiting).getByTestId("thread-group-hint").textContent).toBe(
      "Decisions, reviews, and permission requests.",
    );
    expect(within(waiting).queryByTestId("thread-group-toggle")).toBeNull();
    expect(within(groupOf("resolved")).getByTestId("thread-group-hint").textContent).toBe(
      "Completed threads.",
    );
    expect(within(groupOf("idle")).queryByTestId("thread-group-hint")).toBeNull();
  });

  test("a filter that hides Waiting on you hides its empty group too", () => {
    render(
      <Overview
        entry={entryOf([makeThread({ id: "b", status: "idle" })])}
        hide={["waiting-on-you"]}
      />,
    );

    expect(groups().map((group) => group.getAttribute("data-status"))).toEqual(["idle"]);
  });

  test("each group counts its threads and the newest activity leads", () => {
    render(
      <Overview
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
      <Overview entry={entryOf([makeThread({ id: "t 1", projectId: "p1", title: "Fix it" })])} />,
    );

    const link = screen.getByTestId("thread-card-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/projects/p1/threads/t%201");
    fireEvent.click(link);
    expect(window.location.pathname).toBe("/projects/p1/threads/t%201");
  });
});

describe("a working thread that waits on the person", () => {
  test("is listed under Waiting on you, and the greeting counts it", () => {
    const waits = makeThread({
      id: "waits",
      projectId: "p1",
      title: "Deploy the site",
      status: "working",
      waitingOn: {
        reason: "Approve the deployment",
        link: null,
        since: "2026-09-29T10:00:00.000Z",
      },
    });
    const works = makeThread({
      id: "works",
      projectId: "p1",
      title: "Refactor",
      status: "working",
    });

    render(<Overview entry={entryOf([waits, works])} />);

    expect(titlesIn(groupOf("waiting-on-you"))).toEqual(["Deploy the site"]);
    expect(titlesIn(groupOf("working"))).toEqual(["Refactor"]);
    expect(screen.getByTestId("thread-overview").textContent).toContain(
      "1 thread is waiting on you.",
    );
  });
});

describe("folding", () => {
  test("resolved work starts folded away and opens when asked for; the rest starts open", () => {
    render(<Overview entry={entryOf(onePerStatus())} />);

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
    render(<Overview entry={entryOf(onePerStatus())} />);

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
    render(<Overview entry={entryOf(onePerStatus())} />);

    search("resolved");

    expect(groups().map((group) => group.getAttribute("data-status"))).toEqual(["resolved"]);
    expect(groupOf("resolved").getAttribute("data-open")).toBe("true");
    expect(titlesIn(groupOf("resolved"))).toEqual(["Thread resolved"]);
    expect(screen.getByTestId("thread-count").textContent).toBe("1 of 8");
  });

  test("clearing the search brings back the groups as they were", () => {
    render(<Overview entry={entryOf(onePerStatus())} />);

    search("resolved");
    search("");

    expect(groups()).toHaveLength(8);
    expect(groupOf("resolved").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("thread-count").textContent).toBe("8 threads");
  });

  test("says when nothing matches and draws no group", () => {
    render(<Overview entry={entryOf(onePerStatus())} />);

    search("zzz");

    expect(screen.getByTestId("threads-no-match").textContent).toContain("zzz");
    expect(screen.queryByTestId("thread-group")).toBeNull();
    expect(screen.queryByTestId("thread-groups")).toBeNull();
  });
});

describe("the status filter", () => {
  const OFF: ThreadStatus[] = ["working", "idle"];
  const ONLY_WORKING: ThreadStatus[] = ["working"];

  test("a status switched off leaves the overview, and the count says how many are shown", () => {
    render(<Overview entry={entryOf(onePerStatus())} hide={OFF} />);

    expect(groups().map((group) => group.getAttribute("data-status"))).not.toContain("working");
    expect(groups().map((group) => group.getAttribute("data-status"))).not.toContain("idle");
    expect(screen.getByTestId("thread-count").textContent).toBe("6 of 8");
  });

  test("a filtered overview opens every group, and Clear brings everything back", () => {
    render(<Overview entry={entryOf(onePerStatus())} hide={OFF} />);

    expect(groupOf("resolved").getAttribute("data-open")).toBe("true");
    fireEvent.click(screen.getByTestId("thread-filters-clear"));
    expect(groups()).toHaveLength(8);
    expect(screen.getByTestId("thread-count").textContent).toBe("8 threads");
  });

  test("when the filter leaves nothing it says so", () => {
    render(<Overview entry={entryOf([makeThread({ status: "working" })])} hide={ONLY_WORKING} />);

    expect(screen.getByTestId("threads-no-match").textContent).toBe("No threads match the filter.");
  });
});

describe("the greeting", () => {
  test("says how many threads wait on the person", () => {
    const { rerender } = render(<Overview entry={entryOf(onePerStatus())} />);
    expect(screen.getByTestId("overview-greeting").textContent).toBe("Welcome back.");
    expect(screen.getByTestId("project-attention").textContent).toBe("1 thread is waiting on you.");

    rerender(<Overview entry={entryOf([makeThread({ status: "working" })])} />);
    expect(screen.getByTestId("project-attention").textContent).toBe("Nothing is waiting on you.");
  });
});

describe("before there is anything to group", () => {
  test("says it is loading while the threads are fetched", () => {
    render(<Overview entry={entryOf([], { threadsLoaded: false })} />);

    expect(screen.getByTestId("threads-loading")).toBeTruthy();
    expect(screen.queryByTestId("threads-error")).toBeNull();
  });

  test("says why the threads did not load instead of loading forever, and fetches them again on Try again", () => {
    const entry = entryOf([], { threadsLoaded: false, threadsError: "Request failed (500)" });
    const stub = stubLiveProjects(makeState([entry]));
    render(
      <ProjectsProvider live={stub.live}>
        <Overview entry={entry} />
      </ProjectsProvider>,
    );

    expect(screen.getByTestId("threads-error").getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("threads-error-message").textContent).toBe(
      "Could not load this project's threads: Request failed (500)",
    );
    expect(screen.queryByTestId("threads-loading")).toBeNull();
    expect(screen.queryByTestId("threads-empty")).toBeNull();

    fireEvent.click(screen.getByTestId("threads-retry"));
    expect(stub.calls.refetched).toEqual(["p1"]);
  });

  test("an error left from an earlier fetch does not hide threads that have loaded", () => {
    render(<Overview entry={entryOf(onePerStatus(), { threadsError: "Request failed (500)" })} />);

    expect(screen.getByTestId("thread-overview")).toBeTruthy();
    expect(screen.queryByTestId("threads-error")).toBeNull();
  });

  test("a project with no threads greets the person, says nothing waits, and lists the two groups at 0", () => {
    render(<Overview entry={entryOf([])} />);

    expect(screen.getByTestId("overview-greeting").textContent).toBe("Welcome back.");
    expect(screen.getByTestId("project-attention").textContent).toBe("Nothing is waiting on you.");
    expect(groups().map((group) => group.getAttribute("data-status"))).toEqual([
      "waiting-on-you",
      "resolved",
    ]);
    expect(screen.queryByTestId("threads-no-match")).toBeNull();
  });
});
