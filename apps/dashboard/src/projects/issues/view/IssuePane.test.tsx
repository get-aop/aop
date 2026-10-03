import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { IssueDetail } from "@aop/common";
import { type ApiCall, mockApi } from "../../../test/mock-api";
import { setupDashboardDom } from "../../../test/setup-dom";
import { makeIssue } from "../test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { IssuePane } = await import("./IssuePane");

const KEY = "jira:APP-3";

const DETAIL: IssueDetail = {
  issue: makeIssue({
    key: KEY,
    source: "jira",
    repoId: null,
    container: "Mobile App",
    identifier: "APP-3",
    title: "Sign in with SSO",
    url: "https://acme.atlassian.net/browse/APP-3",
    stage: "started",
    stateName: "In Progress",
    priority: { name: "Highest", level: "urgent" },
    assignees: [{ login: "Mia Krystof", name: "Mia Krystof", avatarUrl: null }],
    author: { login: "Sam Rivera", name: "Sam Rivera", avatarUrl: null },
    labels: [{ name: "auth", color: null }],
    milestone: "2.4.0",
    commentCount: 7,
  }),
  body: "## Steps\n\n1. Open the app\n2. Press **Sign in**\n\n<script>alert(1)</script>",
  sections: [{ title: "Acceptance criteria", body: "- Signs in with Okta" }],
  comments: [
    {
      id: "c1",
      author: { login: "Sam Rivera", name: "Sam Rivera", avatarUrl: null },
      body: "On it",
      createdAt: "2026-09-29T08:00:00.000Z",
    },
  ],
  commentCount: 7,
};

let api: ReturnType<typeof mockApi> | null = null;

const renderPane = async (respond: (call: ApiCall) => Response | undefined) => {
  api = mockApi(respond);
  render(<IssuePane projectId="p1" issueKey={KEY} />);
  await waitFor(() => expect(screen.getByTestId("issue-pane").dataset.state).not.toBe("loading"));
};

const detailPath = `/projects/p1/issues/detail?key=${encodeURIComponent(KEY)}`;

beforeEach(() => {
  window.history.pushState({}, "", `/projects/p1/issues/issue/${encodeURIComponent(KEY)}`);
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe("the issue view", () => {
  test("shows the issue read fresh: facts, description, acceptance criteria and comments", async () => {
    await renderPane((call) =>
      call.path === detailPath ? Response.json({ detail: DETAIL }) : undefined,
    );
    expect(screen.getByTestId("issue-detail-title").textContent).toBe("Sign in with SSO");
    expect(screen.getByTestId("issue-detail-identifier").textContent).toBe("APP-3");
    const facts = screen.getByTestId("issue-detail-facts").textContent ?? "";
    for (const fact of ["In Progress", "Highest", "Mia Krystof", "Reporter", "Fix version2.4.0"]) {
      expect(facts).toContain(fact);
    }
    const body = screen.getByTestId("issue-detail-body");
    expect([...body.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
      "Description",
      "Steps",
    ]);
    expect(body.querySelector("[data-streamdown=strong]")?.textContent).toBe("Sign in");
    expect(body.querySelector("script")).toBeNull();
    expect(body.textContent).toContain("<script>alert(1)</script>");
    expect(screen.getByTestId("issue-detail-section").textContent).toContain("Signs in with Okta");
    expect(screen.getAllByTestId("issue-detail-comment")).toHaveLength(1);
    expect(screen.getByTestId("issue-detail-earlier").textContent).toBe(
      "6 earlier comments in Jira",
    );
    expect(screen.getByTestId("issue-detail-open").getAttribute("href")).toBe(DETAIL.issue.url);
  });

  test("Start a thread asks the coordinator with the issue's key", async () => {
    await renderPane((call) => {
      if (call.path === detailPath) return Response.json({ detail: DETAIL });
      if (call.path === "/projects/p1/issues/start-thread") {
        return Response.json({ message: { id: "m1" } }, { status: 201 });
      }
      return undefined;
    });
    fireEvent.click(screen.getByTestId("issue-detail-start-thread"));
    await waitFor(() =>
      expect(api?.writes()).toEqual([
        { method: "POST", path: "/projects/p1/issues/start-thread", body: { key: KEY } },
      ]),
    );
  });

  test("a refused token says how to reconnect; Try again reads again", async () => {
    let refused = true;
    await renderPane((call) => {
      if (call.path !== detailPath) return undefined;
      return refused
        ? Response.json(
            { error: "Jira refused the token", code: "JIRA_UNAUTHORIZED" },
            { status: 422 },
          )
        : Response.json({ detail: DETAIL });
    });
    const error = screen.getByTestId("issue-pane-error");
    expect(error.textContent).toContain("Reconnect Jira from the Issues tab");
    refused = false;
    fireEvent.click(within(error).getByTestId("issue-pane-retry"));
    expect(await screen.findByTestId("issue-detail")).toBeTruthy();
  });

  test("the breadcrumb and Escape give the chat its place back", async () => {
    await renderPane((call) =>
      call.path === detailPath ? Response.json({ detail: DETAIL }) : undefined,
    );
    fireEvent.click(screen.getByTestId("issue-pane-coordinator"));
    expect(window.location.pathname).toBe("/projects/p1/issues");
    window.history.pushState({}, "", `/projects/p1/issues/issue/${encodeURIComponent(KEY)}`);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(window.location.pathname).toBe("/projects/p1/issues");
  });
});
