import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PullRequestListResponse } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { PullRequestsTab } = await import("./PullRequestsTab");
const { makeEntry, makeProject, makeThread } = await import("../test-utils");
const { fakeListHost, makePull, readyList } = await import("./test-utils");

const project = makeProject({ id: "p1" });

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/p1/pull-requests");
});
afterEach(cleanup);

const mount = (answer: Parameters<typeof fakeListHost>[0], entry = makeEntry(project)) => {
  const host = fakeListHost(answer);
  const view = render(
    <PullRequestsTab entry={entry} options={{ list: host.list, debounceMs: 0, pollMs: 60_000 }} />,
  );
  return { host, view };
};

const rows = () => screen.queryAllByTestId("pr-row");
const numbersShown = () => rows().map((row) => Number(row.getAttribute("data-number")));

describe("the Pull requests tab", () => {
  test("lists the pull requests with what each row shows", async () => {
    mount(() =>
      readyList([
        makePull({
          number: 7,
          title: "Add dark mode",
          state: "draft",
          labels: [{ name: "ui", color: "7057ff" }],
          assignees: [{ login: "ken", avatarUrl: null }],
          review: "changes-requested",
          checks: { state: "failure", successful: 3, failing: 2, pending: 0 },
          comments: 4,
          headRefName: "feat/dark",
        }),
        makePull({ number: 3, state: "merged", review: "approved" }),
      ]),
    );

    await waitFor(() => expect(rows()).toHaveLength(2));
    const row = rows()[0] as HTMLElement;
    const inRow = within(row);
    expect(row.getAttribute("data-state")).toBe("draft");
    expect(inRow.getByTestId("pr-state-icon").getAttribute("aria-label")).toBe("Draft");
    expect(inRow.getByTestId("pr-row-open").textContent).toBe("Add dark mode");
    expect(inRow.getByTestId("pr-ref").textContent).toBe("acme/shop #7");
    // The avatar falls back to the initial, which is hidden from a screen reader.
    expect(inRow.getByTestId("pr-author").textContent).toBe("aada");
    expect(inRow.getByTestId("pr-label").textContent).toBe("ui");
    expect(inRow.getByTestId("pr-assignees").textContent).toContain("ken");
    expect(inRow.getByTestId("pr-review").textContent).toBe("Changes requested");
    expect(inRow.getByTestId("pr-checks").getAttribute("aria-label")).toBe(
      "2 checks failing · 3 passing",
    );
    expect(inRow.getByTestId("pr-branches").textContent).toBe("feat/dark→intomain");
    expect(inRow.getByTestId("pr-comments").textContent).toContain("4");
    expect(within(rows()[1] as HTMLElement).getByTestId("pr-review").textContent).toBe("Approved");
    expect(screen.getByTestId("pr-count").textContent).toBe("2 pull requests");
  });

  test("a pull request of an AOP thread links to that thread", async () => {
    const thread = makeThread({ id: "t9", title: "Dark mode" });
    mount(() => readyList([makePull({ number: 7, threadId: "t9" })]), makeEntry(project, [thread]));

    const link = await screen.findByTestId("pr-thread-link");
    expect(link.getAttribute("href")).toBe("/projects/p1/threads/t9");
    expect(link.getAttribute("title")).toBe("Open thread: Dark mode");
  });

  test("choosing a row opens it in the PR View, and marks it", async () => {
    mount(() => readyList([makePull({ number: 7, repoId: "repo_shop" }), makePull({ number: 8 })]));
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(within(rows()[0] as HTMLElement).getByTestId("pr-row-open"));

    expect(window.location.pathname).toBe("/projects/p1/pull-requests/pulls/repo_shop/7");
    await waitFor(() => expect(rows()[0]?.getAttribute("aria-current")).toBe("true"));
    expect(rows()[1]?.getAttribute("aria-current")).toBeNull();
  });

  test("the state, involves me and sort go to the host, and are kept for the project", async () => {
    const { host } = mount(() => readyList([makePull()]));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(host.last()).toMatchObject({
      state: "open",
      sort: "updated",
      involves: false,
      limit: 50,
    });

    fireEvent.click(screen.getByTestId("pr-state-merged"));
    await waitFor(() => expect(host.last()?.state).toBe("merged"));
    expect(screen.getByTestId("pr-state-merged").getAttribute("data-state")).toBe("on");

    fireEvent.click(screen.getByTestId("pr-involves"));
    await waitFor(() => expect(host.last()?.involves).toBe(true));
    expect(screen.getByTestId("pr-involves").getAttribute("aria-pressed")).toBe("true");

    fireEvent.pointerDown(screen.getByTestId("pr-sort"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("pr-sort-oldest"));
    await waitFor(() => expect(host.last()?.sort).toBe("oldest"));

    cleanup();
    const again = mount(() => readyList([makePull()]));
    await waitFor(() =>
      expect(again.host.last()).toMatchObject({ state: "merged", sort: "oldest", involves: true }),
    );
  });

  test("author, label and assignee are multi-select lists of what the pull requests have", async () => {
    const { host } = mount(() => readyList([makePull()]));
    await waitFor(() => expect(rows()).toHaveLength(1));

    fireEvent.click(screen.getByTestId("pr-filter-author"));
    const options = await screen.findAllByTestId("pr-filter-author-option");
    expect(options.map((option) => option.getAttribute("data-value"))).toEqual(["ada", "grace"]);
    expect(options.map((option) => option.textContent?.slice(-1))).toEqual(["2", "1"]);
    fireEvent.click(options[1] as HTMLElement);
    await waitFor(() => expect(host.last()?.author).toEqual(["grace"]));
    fireEvent.click(screen.getAllByTestId("pr-filter-author-option")[0] as HTMLElement);
    await waitFor(() => expect(host.last()?.author).toEqual(["grace", "ada"]));
    // Ticking does not move rows under the pointer while the list is open.
    expect(
      screen.getAllByTestId("pr-filter-author-option").map((o) => o.getAttribute("data-value")),
    ).toEqual(["ada", "grace"]);
    expect(screen.getByTestId("pr-filter-author").textContent).toBe("Author: 2");

    fireEvent.click(screen.getByTestId("pr-filter-author-clear"));
    await waitFor(() => expect(host.last()?.author).toEqual([]));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByTestId("pr-filter-label"));
    fireEvent.click(await screen.findByText("bug"));
    await waitFor(() => expect(host.last()?.label).toEqual(["bug"]));
    expect(screen.getByTestId("pr-filter-label").textContent).toBe("Label: bug");
  });

  test("the search waits for typing to stop, and Clear filters drops every filter but the state", async () => {
    const { host } = mount((query) =>
      readyList(query.q ? [] : [makePull()], { total: query.q ? 0 : 1 }),
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(screen.getByTestId("pr-state-closed"));

    fireEvent.change(screen.getByTestId("pr-search"), { target: { value: "zzz" } });
    await waitFor(() => expect(host.last()?.q).toBe("zzz"));
    expect(await screen.findByTestId("pr-empty")).toBeTruthy();
    expect(screen.getByTestId("pr-empty").textContent).toContain("No pull requests match");

    fireEvent.click(screen.getByTestId("pr-empty-clear"));
    await waitFor(() => expect(host.last()).toMatchObject({ q: "", state: "closed" }));
    expect((screen.getByTestId("pr-search") as HTMLInputElement).value).toBe("");
  });

  test("another filter starts the list at its top", async () => {
    mount(() => readyList([makePull()]));
    await waitFor(() => expect(rows()).toHaveLength(1));
    const scroll = screen.getByTestId("pr-scroll");
    scroll.scrollTop = 400;

    fireEvent.click(screen.getByTestId("pr-state-merged"));

    await waitFor(() => expect(scroll.scrollTop).toBe(0));
  });

  test("Escape in the search clears it", async () => {
    mount(() => readyList([makePull()]));
    const search = screen.getByTestId("pr-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "abc" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search.value).toBe("");
  });

  test("/ goes to the search", async () => {
    mount(() => readyList([makePull()]));
    await waitFor(() => expect(rows()).toHaveLength(1));
    const open = within(rows()[0] as HTMLElement).getByTestId("pr-row-open");
    open.focus();
    fireEvent.keyDown(open, { key: "/" });
    expect(document.activeElement).toBe(screen.getByTestId("pr-search"));
  });

  test("arrow keys move between the rows", async () => {
    mount(() => readyList([makePull({ number: 1 }), makePull({ number: 2 })]));
    await waitFor(() => expect(rows()).toHaveLength(2));
    const [first, second] = screen.getAllByTestId("pr-row-open") as [HTMLElement, HTMLElement];
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement as Element | null).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(document.activeElement as Element | null).toBe(first);
  });

  test("Show more loads the next page under the first", async () => {
    const { host } = mount((query) =>
      query.cursor
        ? readyList([makePull({ number: 2 })], { total: 2 })
        : readyList([makePull({ number: 1 })], { total: 2, nextCursor: "1" }),
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId("pr-load-more").textContent).toBe("Show more (1 left)");

    fireEvent.click(screen.getByTestId("pr-load-more"));

    await waitFor(() => expect(numbersShown()).toEqual([1, 2]));
    expect(host.last()).toMatchObject({ cursor: "1", limit: 50 });
    expect(screen.queryByTestId("pr-load-more")).toBeNull();
  });

  test("Refresh asks the host to read GitHub again, for every row shown", async () => {
    const { host } = mount(() => readyList([makePull()]));
    await waitFor(() => expect(rows()).toHaveLength(1));

    fireEvent.click(screen.getByTestId("pr-refresh"));

    await waitFor(() => expect(host.last()).toMatchObject({ refresh: true, limit: 50 }));
  });

  test("while the page shows, the list is read again now and then", async () => {
    const host = fakeListHost(() => readyList([makePull()]));
    render(
      <PullRequestsTab
        entry={makeEntry(project)}
        options={{ list: host.list, debounceMs: 0, pollMs: 30 }}
      />,
    );
    await waitFor(() => expect(host.queries.length).toBeGreaterThanOrEqual(3));
    expect(host.queries.every((query) => !query.refresh)).toBe(true);
  });

  describe("states", () => {
    test("loading shows placeholder rows", () => {
      mount(() => readyList([]));
      expect(screen.getByTestId("pr-loading")).toBeTruthy();
    });

    test("no pull requests at all says so, without a Clear button", async () => {
      mount(() => readyList([]));
      const empty = await screen.findByTestId("pr-empty");
      expect(empty.textContent).toContain("No pull requests here");
      expect(screen.queryByTestId("pr-empty-clear")).toBeNull();
    });

    test.each([
      ["signed-out", "Not signed in to GitHub", "gh auth login", true],
      ["gh-missing", "GitHub CLI not found", "brew install gh", true],
      ["unreachable", "GitHub is out of reach", null, true],
      ["no-repos", "No repositories yet", null, false],
      ["no-github-repos", "No GitHub repositories", null, false],
    ] as const)("%s says why, and how to fix it", async (reason, title, hint, retry) => {
      const response: PullRequestListResponse = {
        status: "unavailable",
        reason,
        message: "from the host",
        repos: [],
      };
      const { host } = mount(() => response);
      const notice = await screen.findByTestId("pr-unavailable");
      expect(notice.getAttribute("data-reason")).toBe(reason);
      expect(notice.textContent).toContain(title);
      expect(notice.textContent).toContain("from the host");
      if (hint) expect(notice.textContent).toContain(hint);
      expect(screen.queryByTestId("pr-toolbar")).toBeNull();
      expect(screen.queryByTestId("pr-retry") !== null).toBe(retry);
      if (retry) {
        fireEvent.click(screen.getByTestId("pr-retry"));
        await waitFor(() => expect(host.last()?.refresh).toBe(true));
      }
    });

    test("a host that fails says so, and Try again reads again", async () => {
      let failing = true;
      mount(() => (failing ? new Error("Request failed (502)") : readyList([makePull()])));
      expect((await screen.findByTestId("pr-error")).textContent).toContain("Request failed (502)");

      failing = false;
      fireEvent.click(screen.getByTestId("pr-retry"));
      await waitFor(() => expect(rows()).toHaveLength(1));
    });

    test("a failed refresh keeps the list and says it is stale", async () => {
      let failing = false;
      mount(() => (failing ? new Error("offline") : readyList([makePull()])));
      await waitFor(() => expect(rows()).toHaveLength(1));

      failing = true;
      fireEvent.click(screen.getByTestId("pr-refresh"));

      expect((await screen.findByTestId("pr-stale")).textContent).toContain("offline");
      expect(rows()).toHaveLength(1);
    });

    test("a repository that could not be read, one cut short and one not on GitHub are named", async () => {
      mount(() =>
        readyList([makePull()], {
          repos: [
            {
              repoId: "a",
              name: "shop",
              nameWithOwner: "acme/shop",
              error: "API rate limit exceeded",
              truncated: true,
            },
            { repoId: "b", name: "notes", nameWithOwner: null, error: null, truncated: false },
          ],
        }),
      );
      expect((await screen.findByTestId("pr-repo-errors")).textContent).toBe(
        "acme/shop: API rate limit exceeded",
      );
      expect(screen.getByTestId("pr-truncated").textContent).toContain("acme/shop");
      expect(screen.getByTestId("pr-local-repos").textContent).toBe("Not on GitHub: notes");
    });
  });

  test("an answer to an older request is dropped", async () => {
    let release: (value: PullRequestListResponse) => void = () => {};
    const slow = new Promise<PullRequestListResponse>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const list = async () => {
      calls += 1;
      return calls === 1 ? slow : readyList([makePull({ number: 2 })]);
    };
    render(
      <PullRequestsTab
        entry={makeEntry(project)}
        options={{ list, debounceMs: 0, pollMs: 60_000 }}
      />,
    );
    fireEvent.click(screen.getByTestId("pr-state-closed"));
    await waitFor(() => expect(numbersShown()).toEqual([2]));

    await act(async () => release(readyList([makePull({ number: 1 })])));

    expect(numbersShown()).toEqual([2]);
  });
});
