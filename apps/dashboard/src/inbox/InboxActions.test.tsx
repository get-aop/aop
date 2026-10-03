import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  makeEntry,
  makeProject,
  makeState,
  makeThread,
  stubLiveProjects,
} from "../projects/test-utils";
import { setupDashboardDom } from "../test/setup-dom";
import { installInboxHost, makeInboxItem } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { ConfirmationHost } = await import("../components/ConfirmationHost");
const { InboxPage } = await import("./InboxPage");
const { InboxButton } = await import("./InboxButton");
const { parsePasted } = await import("./LinkDialog");
const { resetInboxSummaryForTests } = await import("./inbox-summary-store");
const { snoozeChoices, relativeTime, whereOf, splitLinks } = await import("./inbox-format");

let inbox: ReturnType<typeof installInboxHost>;

const DRAFT = {
  title: "can you take the flaky deploy check?",
  brief: "Handle what this Slack message asks for.\n\n<<< slack message\nhi\nslack message >>>",
  contextLength: 1200,
  projectId: "p1",
  postBackPreview: [
    "Opened a PR for this: owner/repo#123 can you take the flaky deploy check? (via AOP)",
    "Merged: owner/repo#123 (via AOP)",
  ],
};

beforeEach(() => {
  resetInboxSummaryForTests();
  inbox = installInboxHost((call) => {
    const route = ROUTES[`${call.method} ${call.path.split("?")[0]}`];
    return route?.();
  });
});

const ISSUES = () =>
  Response.json({
    issues: [
      {
        key: "jira:OPS-1184",
        source: "jira",
        repoId: null,
        container: "OPS",
        identifier: "OPS-1184",
        title: "Deploy check flaky on small runners",
        url: "https://acme.atlassian.net/browse/OPS-1184",
        state: "open",
        stage: "started",
        stateName: "In Progress",
        stateColor: null,
        labels: [],
        assignees: [],
        author: null,
        milestone: null,
        priority: null,
        commentCount: 0,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        linkedPullRequests: [],
      },
    ],
    sources: [],
  });

const ROUTES: Record<string, () => Response> = {
  "GET /inbox/items/inbx_1/dispatch": () => Response.json({ draft: DRAFT }),
  "POST /inbox/items/inbx_1/dispatch": () =>
    Response.json(
      { item: { ...inbox.host.items[0], links: [] }, threadId: "isess_new" },
      { status: 201 },
    ),
  "POST /inbox/items/inbx_1/links": () =>
    Response.json({ item: inbox.host.items[0] }, { status: 201 }),
  "GET /status": () => Response.json({ repos: [] }),
  "GET /projects/p1/issues": ISSUES,
};

afterEach(() => {
  cleanup();
  inbox.api.restore();
});

const renderPage = () => {
  window.history.pushState({}, "", "/inbox/inbx_1");
  const stub = stubLiveProjects(
    makeState([
      makeEntry(makeProject({ id: "p1", name: "aop", repoIds: ["r1"] }), [
        makeThread({ id: "t1", projectId: "p1", title: "Fix flaky deploy check" }),
      ]),
    ]),
  );
  return render(
    <ProjectsProvider live={stub.live}>
      <InboxPage itemId="inbx_1" />
      <ConfirmationHost />
    </ProjectsProvider>,
  );
};

describe("dispatching a thread", () => {
  test("starts the thread with the edited brief, in the mapped project, post-back off", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("inbox-dispatch-open"));
    const brief = await screen.findByTestId("inbox-dispatch-brief");
    expect((brief as HTMLTextAreaElement).value).toContain("<<< slack message");
    fireEvent.change(brief, { target: { value: "Fix the deploy check." } });
    expect(screen.getByTestId("inbox-dispatch").textContent).toContain("1.2k characters");
    fireEvent.click(screen.getByTestId("inbox-dispatch-start"));
    await waitFor(() =>
      expect(inbox.api.writes()).toContainEqual({
        method: "POST",
        path: "/inbox/items/inbx_1/dispatch",
        body: {
          projectId: "p1",
          mode: "thread",
          repoId: null,
          title: DRAFT.title,
          brief: "Fix the deploy check.",
          includeContext: true,
          issueLinkId: null,
          attachLink: true,
          postBack: false,
        },
      }),
    );
  });

  test("the PR notes ask first, with the exact text, and stay off when kept off", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("inbox-dispatch-open"));
    fireEvent.change(await screen.findByTestId("inbox-dispatch-title"), {
      target: { value: "Fix the deploy check" },
    });
    fireEvent.click(await screen.findByTestId("inbox-dispatch-postback"));
    const dialog = await screen.findByRole("alertdialog");
    // The note names the thread by the title the person gave it.
    expect(dialog.textContent).toContain("owner/repo#123 Fix the deploy check (via AOP)");
    expect(dialog.textContent).toContain("Merged: owner/repo#123 (via AOP)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep off" }));
    await waitFor(() =>
      expect(screen.getByTestId("inbox-dispatch-postback").getAttribute("data-state")).toBe(
        "unchecked",
      ),
    );
    fireEvent.click(screen.getByTestId("inbox-dispatch-postback"));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Post these notes",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("inbox-dispatch-postback").getAttribute("data-state")).toBe(
        "checked",
      ),
    );
  });
});

describe("linking", () => {
  test("links an issue from the project's Issues tab, or a pasted key", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("inbox-link-open"));
    const result = await screen.findByTestId("inbox-link-result");
    expect(result.textContent).toContain("OPS-1184 Deploy check flaky on small runners");
    fireEvent.click(result);
    await waitFor(() =>
      expect(inbox.api.writes()).toContainEqual({
        method: "POST",
        path: "/inbox/items/inbx_1/links",
        body: {
          kind: "issue",
          ref: "jira:OPS-1184",
          projectId: "p1",
          title: "Deploy check flaky on small runners",
          url: "https://acme.atlassian.net/browse/OPS-1184",
        },
      }),
    );
  });

  test("threads come from the project, and pasted addresses become links", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("inbox-link-open"));
    fireEvent.click(await screen.findByTestId("inbox-link-tab-threads"));
    expect((await screen.findByTestId("inbox-link-result")).textContent).toContain(
      "Fix flaky deploy check",
    );
    expect(parsePasted("https://github.com/get-aop/aop/pull/71", "p1")).toEqual({
      kind: "pull-request",
      ref: "get-aop/aop#71",
      url: "https://github.com/get-aop/aop/pull/71",
      projectId: "p1",
    });
    expect(parsePasted("https://linear.app/acme/issue/PLAT-212/x", null)).toMatchObject({
      kind: "issue",
      ref: "PLAT-212",
    });
    expect(parsePasted("#58", null)).toEqual({ kind: "issue", ref: "#58", projectId: null });
    expect(parsePasted("hello", null)).toBeNull();
  });

  test("a link chip shows its thread's status and is removed with ×", async () => {
    inbox.host.items = [
      makeInboxItem({
        links: [
          {
            id: "inlk_1",
            kind: "thread",
            ref: "t1",
            projectId: "p1",
            title: "Fix flaky deploy check",
            url: null,
            status: "working",
            postBack: true,
            createdAt: "2026-10-03T10:50:00.000Z",
          },
        ],
      }),
    ];
    renderPage();
    const chip = await screen.findByTestId("inbox-link");
    expect(chip.textContent).toContain("Thread · Fix flaky deploy check");
    expect(within(chip).getByTestId("inbox-postback-off")).toBeDefined();
  });
});

describe("the item's menu", () => {
  test("mutes the channel through the rules", async () => {
    renderPage();
    fireEvent.pointerDown(await screen.findByTestId("inbox-more"), {
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByTestId("inbox-more-mute"));
    await waitFor(() =>
      expect(inbox.host.rules.channels.C1).toEqual({ mode: "muted", name: "infra" }),
    );
  });
});

describe("the top bar's Inbox", () => {
  test("shows the unread count once Slack is connected, and nothing before", async () => {
    window.history.pushState({}, "", "/");
    const { unmount } = render(<InboxButton />);
    expect((await screen.findByTestId("inbox-unread")).textContent).toBe("1");
    expect(screen.getByTestId("inbox-button").getAttribute("href")).toBe("/inbox");
    unmount();
    resetInboxSummaryForTests();
    inbox.host.sources = { slack: null, slackImportAvailable: false };
    render(<InboxButton />);
    await waitFor(() => expect(inbox.api.calls.length).toBeGreaterThan(1));
    expect(screen.queryByTestId("inbox-button")).toBeNull();
  });
});

describe("the Inbox's words", () => {
  test("where, when, links and snooze times", () => {
    expect(whereOf({ conversation: { id: "D1", name: "Jonas", kind: "dm" }, threadId: null })).toBe(
      "DM",
    );
    expect(
      whereOf({ conversation: { id: "G1", name: "Ana, Jonas", kind: "group-dm" }, threadId: null }),
    ).toBe("Group DM · Ana, Jonas");
    const now = Date.parse("2026-10-03T12:00:00.000Z");
    expect(relativeTime("2026-10-03T11:56:00.000Z", now)).toBe("4m");
    expect(relativeTime("2026-10-03T09:00:00.000Z", now)).toBe("3h");
    expect(relativeTime("2026-10-02T09:00:00.000Z", now)).toBe("Yesterday");
    expect(splitLinks("see https://x.dev/a now").map((part) => part.url)).toEqual([
      false,
      true,
      false,
    ]);
    const morning = new Date(2026, 9, 3, 9, 0);
    expect(snoozeChoices(morning).map((choice) => choice.id)).toEqual([
      "hour",
      "afternoon",
      "tomorrow",
      "monday",
    ]);
    expect(snoozeChoices(new Date(2026, 9, 3, 16, 0)).map((choice) => choice.id)).not.toContain(
      "afternoon",
    );
  });
});
