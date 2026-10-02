import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { IssueList } from "@aop/common";
import { type ApiCall, mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { issueList, LINEAR_NOT_CONFIGURED, makeIssue, SAMPLE, sourceStatus } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { IssuesTab } = await import("./IssuesTab");

let api: ReturnType<typeof mockApi> | null = null;

/** The tab on a host that lists `list` (or what `respond` says) and answers the owner check. */
const renderTab = async (
  list: IssueList | ((call: ApiCall) => IssueList),
  options: { owner?: boolean; respond?: (call: ApiCall) => Response | undefined } = {},
) => {
  const principal =
    options.owner === false ? { kind: "device", device: { id: "d1" } } : { kind: "owner" };
  const answer = (call: ApiCall): Response | undefined => {
    if (call.path === "/auth/me") return Response.json(principal);
    if (!call.path.startsWith("/projects/p1/issues?")) return undefined;
    return Response.json(typeof list === "function" ? list(call) : list);
  };
  api = mockApi((call) => options.respond?.(call) ?? answer(call));
  render(<IssuesTab projectId="p1" />);
  await screen.findByTestId("issues-count");
  await waitFor(() => expect(screen.getByTestId("issues-tab").dataset.state).not.toBe("loading"));
};

const groups = () =>
  screen
    .getAllByTestId("issue-group")
    .map((group) => [
      within(group).getByTestId("issue-group-toggle").textContent,
      group.dataset.open,
    ]);

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/projects/p1/issues");
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe("the Issues tab", () => {
  test("groups issues by status with counts; finished work starts folded", async () => {
    await renderTab(issueList(SAMPLE));

    expect(screen.getByTestId("issues-count").textContent).toBe("4 issues");
    expect(groups()).toEqual([
      ["In Progress1", "true"],
      ["Open2", "true"],
      ["Closed1", "false"],
    ]);
    expect(api?.calls[0]?.path ?? api?.calls[1]?.path).toBeDefined();
    expect(
      api?.calls.some((call) => call.path === "/projects/p1/issues?state=open&limit=100&refresh=0"),
    ).toBe(true);
  });

  test("a row shows its source, identifier, title link, labels, pull requests, comments and assignees", async () => {
    await renderTab(issueList(SAMPLE));
    const row = screen
      .getAllByTestId("issue-row")
      .find((item) => item.dataset.key === "github:acme/app#3");
    if (!row) throw new Error("no row");
    const inRow = within(row);

    expect(inRow.getByTestId("issue-source").dataset.source).toBe("github");
    expect(inRow.getByTestId("issue-identifier").textContent).toBe("#3");
    expect(inRow.getByTestId("issue-title").getAttribute("href")).toBe(
      "https://github.com/acme/app/issues/1",
    );
    expect(inRow.getAllByTestId("issue-label").map((label) => label.textContent)).toEqual(["bug"]);
    expect(
      inRow
        .getAllByTestId("issue-pr-chip")
        .map((chip) => [chip.textContent, chip.dataset.state, chip.dataset.checks]),
    ).toEqual([
      ["#40", "open", "failing"],
      ["#7", "merged", undefined],
    ]);
    expect(inRow.getAllByTestId("issue-comments")[0]?.textContent).toBe("5");
    expect(inRow.getByTestId("issue-assignees").getAttribute("aria-label")).toBe("Assigned to bo");
  });

  test("a folded group opens and closes", async () => {
    await renderTab(issueList(SAMPLE));
    const closed = screen.getAllByTestId("issue-group-toggle")[2] as HTMLElement;

    fireEvent.click(closed);
    expect(groups()[2]).toEqual(["Closed1", "true"]);
    fireEvent.click(closed);
    expect(groups()[2]).toEqual(["Closed1", "false"]);
  });

  test("search narrows the rows, opens every group, and Clear brings them back", async () => {
    await renderTab(issueList(SAMPLE));

    fireEvent.change(screen.getByTestId("issues-search"), { target: { value: "old done" } });
    expect(screen.getByTestId("issues-count").textContent).toBe("1 of 4");
    expect(groups()).toEqual([["Closed1", "true"]]);

    fireEvent.click(screen.getByTestId("issues-clear"));
    expect(screen.getByTestId("issues-count").textContent).toBe("4 issues");
  });

  test("a search that matches nothing says so and clears", async () => {
    await renderTab(issueList(SAMPLE));
    fireEvent.change(screen.getByTestId("issues-search"), { target: { value: "zzz" } });
    expect(screen.getByTestId("issues-no-match")).toBeTruthy();
    fireEvent.click(screen.getByTestId("issues-no-match-clear"));
    expect(screen.getAllByTestId("issue-row")).toHaveLength(3);
  });

  test("Escape in the search clears it, and / puts the cursor there", async () => {
    await renderTab(issueList(SAMPLE));
    const search = screen.getByTestId("issues-search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "crash" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search.value).toBe("");

    search.blur();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement === search).toBe(true);
    // Typed into another field, "/" is just a character.
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement === other).toBe(true);
    other.remove();
  });

  test("the state switch reads that state from the host, and is remembered", async () => {
    await renderTab((call) =>
      call.path.includes("state=closed") ? issueList([SAMPLE[3] as never]) : issueList(SAMPLE),
    );

    fireEvent.click(screen.getByTestId("issues-state-closed"));
    await waitFor(() => expect(screen.getByTestId("issues-count").textContent).toBe("1 issue"));
    expect(api?.calls.at(-1)?.path).toBe("/projects/p1/issues?state=closed&limit=100&refresh=0");
    expect(JSON.parse(localStorage.getItem("aop:issues-view:v1:p1") ?? "{}").state).toBe("closed");
    // Alone, done work is not folded away.
    expect(groups()).toEqual([["Closed1", "true"]]);
  });

  test("Refresh asks the host to read again; a failed refresh keeps the list and says so", async () => {
    let fail = false;
    await renderTab(issueList(SAMPLE), {
      respond: (call) =>
        fail && call.path.includes("refresh=1")
          ? Response.json({ error: "boom" }, { status: 500 })
          : undefined,
    });

    fireEvent.click(screen.getByTestId("issues-refresh"));
    await waitFor(() =>
      expect(api?.calls.some((call) => call.path.endsWith("refresh=1"))).toBe(true),
    );
    fail = true;
    fireEvent.click(screen.getByTestId("issues-refresh"));
    expect((await screen.findByTestId("issues-refresh-failed")).getAttribute("title")).toBe("boom");
    expect(screen.getAllByTestId("issue-row").length).toBeGreaterThan(0);
  });

  test("Load older issues asks for the next page when a source has more", async () => {
    await renderTab(issueList(SAMPLE, [sourceStatus({ hasMore: true }), LINEAR_NOT_CONFIGURED]));
    fireEvent.click(screen.getByTestId("issues-load-more"));
    await waitFor(() =>
      expect(api?.calls.at(-1)?.path).toBe("/projects/p1/issues?state=open&limit=200&refresh=0"),
    );
  });

  test("a host that cannot be read shows the error, and Try again reads again", async () => {
    let down = true;
    await renderTab(issueList(SAMPLE), {
      respond: (call) =>
        down && call.path.startsWith("/projects/p1/issues")
          ? Response.json({ error: "Project not found" }, { status: 404 })
          : undefined,
    });
    expect(screen.getByTestId("issues-error").textContent).toContain("Project not found");

    down = false;
    fireEvent.click(screen.getByTestId("issues-retry"));
    await waitFor(() => expect(screen.getAllByTestId("issue-row").length).toBe(3));
  });

  test("Start thread posts the issue's key and confirms", async () => {
    await renderTab(issueList(SAMPLE), {
      respond: (call) =>
        call.method === "POST" && call.path === "/projects/p1/issues/start-thread"
          ? Response.json({ message: { id: "m1" } }, { status: 201 })
          : undefined,
    });
    const row = screen.getAllByTestId("issue-row")[0] as HTMLElement;

    await act(async () => {
      fireEvent.click(within(row).getByTestId("issue-start-thread"));
    });

    expect(api?.writes()).toEqual([
      { method: "POST", path: "/projects/p1/issues/start-thread", body: { key: "linear:ENG-9" } },
    ]);
  });

  test("a pull request chip in a project repository opens the PR View; one elsewhere is a link", async () => {
    await renderTab(issueList(SAMPLE));
    const [inProject, elsewhere] = screen.getAllByTestId("issue-pr-chip") as [
      HTMLElement,
      HTMLElement,
    ];

    expect(fireEvent.click(elsewhere)).toBe(true);
    expect(window.location.pathname).toBe("/projects/p1/issues");
    expect(fireEvent.click(inProject)).toBe(false);
    expect(window.location.pathname).toBe("/projects/p1/issues/pulls/repo_1/40");
  });

  test("Cmd-click on a chip keeps the link to GitHub", async () => {
    await renderTab(issueList(SAMPLE));
    const [inProject] = screen.getAllByTestId("issue-pr-chip") as [HTMLElement];
    expect(fireEvent.click(inProject, { metaKey: true })).toBe(true);
    expect(window.location.pathname).toBe("/projects/p1/issues");
  });
});

describe("the Issues tab's notices and empty states", () => {
  test("gh signed out on the host explains the fix and copies the command", async () => {
    await renderTab(
      issueList(
        [],
        [sourceStatus({ status: "not-authenticated", fetchedAt: null }), LINEAR_NOT_CONFIGURED],
      ),
    );
    expect(screen.getByTestId("issues-notice-github-auth").textContent).toContain("gh auth login");
    expect(screen.getByTestId("issues-copy-gh-login")).toBeTruthy();
  });

  test("a missing gh says to install it", async () => {
    await renderTab(issueList([], [sourceStatus({ status: "gh-missing" }), LINEAR_NOT_CONFIGURED]));
    expect(screen.getByTestId("issues-notice-github-auth").textContent).toContain("not installed");
    expect(screen.queryByTestId("issues-copy-gh-login")).toBeNull();
  });

  test("a failed source shows its error and how old the issues are", async () => {
    await renderTab(
      issueList(SAMPLE, [
        sourceStatus({ status: "error", message: "HTTP 502", stale: true }),
        LINEAR_NOT_CONFIGURED,
      ]),
    );
    expect(screen.getByTestId("issues-notice-error").textContent).toContain(
      "HTTP 502. Showing the issues read",
    );
  });

  test("the owner is invited to connect Linear, can dismiss it for good, and a device is told who can", async () => {
    await renderTab(issueList(SAMPLE));
    await screen.findByTestId("issues-linear-connect");
    fireEvent.click(screen.getByTestId("issues-notice-linear-dismiss"));
    expect(screen.queryByTestId("issues-notice-linear")).toBeNull();
    cleanup();
    api?.restore();
    localStorage.clear();

    await renderTab(issueList(SAMPLE), { owner: false });
    expect(screen.getByTestId("issues-notice-linear").textContent).toContain("host owner");
    expect(screen.queryByTestId("issues-linear-connect")).toBeNull();
  });

  test("a refused Linear key offers to reconnect", async () => {
    await renderTab(
      issueList(SAMPLE, [
        sourceStatus(),
        sourceStatus({ source: "linear", id: "linear", name: "Eng", status: "unauthorized" }),
      ]),
    );
    expect(await screen.findByTestId("issues-linear-reconnect")).toBeTruthy();
  });

  test("no source at all says how to add one; a source with nothing open says that", async () => {
    await renderTab(
      issueList(
        [],
        [
          sourceStatus({ name: "notes", status: "no-github-remote", fetchedAt: null }),
          LINEAR_NOT_CONFIGURED,
        ],
      ),
    );
    expect(screen.getByTestId("issues-no-sources")).toBeTruthy();
    expect(screen.getByTestId("issues-notice-off-github").textContent).toContain(
      "notes has no GitHub remote",
    );
    cleanup();
    api?.restore();

    await renderTab(issueList([]));
    expect(screen.getByTestId("issues-empty").textContent).toContain("No open issues");
  });

  test("an issue from one source only still lists the source filter only when there are two", async () => {
    await renderTab(issueList([makeIssue()]));
    expect(screen.getByTestId("issues-count").textContent).toBe("1 issue");
  });
});
