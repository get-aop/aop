import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../projects/test-utils";
import { setupDashboardDom } from "../test/setup-dom";
import { installInboxHost, makeInboxItem } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { ConfirmationHost } = await import("../components/ConfirmationHost");
const { InboxPage } = await import("./InboxPage");
const { resetInboxSummaryForTests } = await import("./inbox-summary-store");
const { resetDialogs, getDialogs } = await import("../shell/dialog-store");

let inbox: ReturnType<typeof installInboxHost>;
let opened: string[];
const originalOpen = window.open;

beforeEach(() => {
  resetInboxSummaryForTests();
  opened = [];
  window.open = ((url: string) => {
    opened.push(url);
    return null;
  }) as typeof window.open;
  inbox = installInboxHost((call) => {
    if (call.path.startsWith("/inbox/items/inbx_1/reply")) {
      const item = { ...inbox.host.items[0], state: "read" as const };
      return Response.json(
        {
          message: {
            id: "1700000000.000900",
            author: { id: "U1", name: "Marcelo", avatarUrl: null },
            text: (call.body as { text: string }).text,
            sentAt: "2026-10-03T10:51:00.000Z",
            fromMe: true,
            fromAop: true,
          },
          item,
        },
        { status: 201 },
      );
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  inbox.api.restore();
  resetDialogs();
  window.open = originalOpen;
});

const renderPage = (itemId: string | null) => {
  window.history.pushState({}, "", itemId ? `/inbox/${itemId}` : "/inbox");
  const stub = stubLiveProjects(makeState([makeEntry(makeProject({ id: "p1", name: "aop" }), [])]));
  return render(
    <ProjectsProvider live={stub.live}>
      <InboxPage itemId={itemId} />
      <ConfirmationHost />
    </ProjectsProvider>,
  );
};

describe("the Inbox page", () => {
  test("lists what needs the person: who, where, why, and the unread mark", async () => {
    renderPage(null);
    const row = await screen.findByTestId("inbox-row");
    expect(row.textContent).toContain("Priya Rao");
    expect(row.textContent).toContain("#infra · thread");
    expect(within(row).getByTestId("inbox-reason").textContent).toBe("@you");
    expect(within(row).queryByTestId("inbox-row-unread")).not.toBeNull();
    expect(screen.getByTestId("inbox-view-needs-me").textContent).toContain("1");
    expect((await screen.findByTestId("inbox-feed-status")).dataset.health).toBe("live");
  });

  test("an opened item reads as read, shows why it is here, its link, and its context", async () => {
    renderPage("inbx_1");
    const item = await screen.findByTestId("inbox-item");
    expect(item.textContent).toContain("Here because someone mentioned you directly");
    expect(within(item).getByRole("link", { name: "https://ci.dev/1" })).toBeDefined();
    await waitFor(() =>
      expect(inbox.api.writes()).toContainEqual({
        method: "PUT",
        path: "/inbox/items/inbx_1/state",
        body: { state: "read" },
      }),
    );
    fireEvent.click(screen.getByTestId("inbox-context-toggle"));
    expect((await screen.findByTestId("inbox-context-earlier")).textContent).toBe(
      "2 earlier replies",
    );
    expect(screen.getByTestId("inbox-context").textContent).toContain("deploy-check failed again");
  });

  test("replies as the person only when they press Send, and shows the reply from AOP", async () => {
    renderPage("inbx_1");
    const box = await screen.findByTestId("inbox-reply-text");
    expect(box.getAttribute("placeholder")).toBe("Reply in thread as Marcelo…");
    fireEvent.change(box, { target: { value: "On it" } });
    fireEvent.click(screen.getByTestId("inbox-reply-broadcast"));
    expect(inbox.api.writes().some((call) => call.path.endsWith("/reply"))).toBe(false);
    fireEvent.click(screen.getByTestId("inbox-reply-send"));
    await waitFor(() =>
      expect(inbox.api.writes()).toContainEqual({
        method: "POST",
        path: "/inbox/items/inbx_1/reply",
        body: { text: "On it", broadcast: true },
      }),
    );
    fireEvent.click(screen.getByTestId("inbox-context-toggle"));
    const sent = await screen.findAllByTestId("inbox-context-message");
    expect(sent.at(-1)?.textContent).toContain("from AOP");
  });

  test("keys: E marks done, O opens Slack, and J moves on", async () => {
    inbox.host.items = [makeInboxItem(), makeInboxItem({ id: "inbx_2", text: "second" })];
    renderPage("inbx_1");
    await screen.findByTestId("inbox-item");
    await act(async () => {
      fireEvent.keyDown(window, { key: "o" });
    });
    expect(opened).toEqual(["https://acme.slack.com/archives/C1/p1700000000000500"]);
    await act(async () => {
      fireEvent.keyDown(window, { key: "e" });
    });
    await waitFor(() =>
      expect(inbox.api.writes()).toContainEqual({
        method: "PUT",
        path: "/inbox/items/inbx_1/state",
        body: { state: "done" },
      }),
    );
    await waitFor(() => expect(window.location.pathname).toBe("/inbox/inbx_2"));
  });

  test("snoozes until a chosen time", async () => {
    renderPage("inbx_1");
    await screen.findByTestId("inbox-item");
    fireEvent.pointerDown(screen.getByTestId("inbox-snooze"), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByTestId("inbox-snooze-tomorrow"));
    await waitFor(() => {
      const snooze = inbox.api
        .writes()
        .find(
          (call) =>
            call.path.endsWith("/state") && (call.body as { state: string }).state === "snoozed",
        );
      expect(snooze).toBeDefined();
    });
  });

  test("before Slack is connected it says how to connect", async () => {
    inbox.host.sources = { slack: null, slackImportAvailable: false };
    inbox.host.items = [];
    renderPage(null);
    fireEvent.click(within(await screen.findByTestId("inbox-not-connected")).getByRole("button"));
    expect(getDialogs().settings).toEqual({ open: true, section: "connections" });
  });
});
