import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Message } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeProject, makeThread } from "../test-utils";
import type { ChatApi } from "./chat-api";
import { at, deferred, page, reply, report, userMessage } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, screen, waitFor, within } = await import("@testing-library/react");
const { mockFetch, pressEnter, settled, setup, type } = await import("./pane-test-harness");

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/prj_1/chat");
  net = mockFetch();
});

afterEach(() => {
  cleanup();
  net.restore();
});

describe("a conversation longer than the host sends at once", () => {
  const host: ChatApi["listMessages"] = async (_projectId, before) =>
    before === undefined
      ? page([userMessage("u3", 3, { text: "Newest question" }), reply("a3", 4)], true)
      : page([userMessage("u1", 1, { text: "Oldest question" }), reply("a1", 2)]);

  test("offers to load the earlier messages, asks the host for the page before the oldest one shown, and shows them above", async () => {
    const asked: (string | undefined)[] = [];
    setup({
      listMessages: (projectId, before) => {
        asked.push(before);
        return host(projectId, before);
      },
    });
    await settled();
    expect(screen.getByTestId("chat-load-earlier").textContent).toBe("Load earlier messages");

    fireEvent.click(screen.getByTestId("chat-load-earlier"));
    await settled();

    expect(asked).toEqual([undefined, "u3"]);
    expect(
      screen.getAllByTestId("user-message").map((row) => row.textContent?.includes("question")),
    ).toEqual([true, true]);
    const rows = screen.getAllByTestId("chat-scroll")[0]?.querySelectorAll("[data-message-id]");
    expect([...(rows ?? [])].map((row) => row.getAttribute("data-message-id"))).toEqual([
      "u1",
      "a1",
      "u3",
      "a3",
    ]);
    expect(screen.queryByTestId("chat-load-earlier")).toBeNull();
  });
});

describe("loading", () => {
  test("shows that it is loading, then the conversation", async () => {
    const fetched = deferred<Message[]>();
    setup({ fetches: [fetched.promise] });
    expect(screen.getByTestId("chat-loading")).toBeTruthy();

    fetched.resolve([userMessage("u1", 1, { text: "Plan the release" }), reply("a1", 2)]);
    await settled();

    expect(screen.queryByTestId("chat-loading")).toBeNull();
    expect(screen.getByTestId("user-message").textContent).toContain("Plan the release");
    expect(screen.getByTestId("assistant-message").textContent).toContain("reply a1");
  });

  test("says why when the first fetch fails, and shows the conversation once a retry works", async () => {
    const first = deferred<Message[]>();
    setup({
      fetches: [first.promise, Promise.resolve([userMessage("u1", 1, { text: "Hello again" })])],
    });
    first.reject(new Error("Host unreachable"));
    await settled();

    expect(screen.getByTestId("chat-error").textContent).toContain("Host unreachable");

    fireEvent.click(screen.getByTestId("chat-retry"));
    await settled();

    expect(screen.queryByTestId("chat-error")).toBeNull();
    expect(screen.getByTestId("user-message").textContent).toContain("Hello again");
  });

  test("a conversation that cannot be refreshed keeps what it has and says so", async () => {
    const refresh = deferred<Message[]>();
    const { fake } = setup({
      fetches: [Promise.resolve([userMessage("u1", 1, { text: "Still here" })]), refresh.promise],
    });
    await settled();

    act(() => fake.resync());
    refresh.reject(new Error("Host unreachable"));
    await settled();

    expect(screen.getByTestId("chat-refresh-error").textContent).toContain("Host unreachable");
    expect(screen.getByTestId("user-message").textContent).toContain("Still here");
  });
});

describe("the conversation", () => {
  test("shows the person's messages, the coordinator's replies with their cards, and a thread's report as an event", async () => {
    const threads = [makeThread({ id: "thr_1", title: "Fix login", status: "waiting-on-you" })];
    setup({
      threads,
      fetches: [
        Promise.resolve([
          userMessage("u1", 1, { text: "Fix the login redirect" }),
          reply("a1", 2, [
            { type: "text", text: "On it." },
            { type: "routing-receipt", threadIds: ["thr_1"] },
            { type: "thread-card", threadId: "thr_1", variant: "live" },
          ]),
          report("r1", 3, { outcome: "needs-you" }),
        ]),
      ],
    });
    await settled();

    expect(screen.getByTestId("assistant-message").textContent).toContain("On it.");
    expect(screen.getByTestId("routing-receipt").textContent).toContain("Sent to one thread");
    expect(screen.getByTestId("chat-thread-card").getAttribute("data-thread-id")).toBe("thr_1");
    const event = screen.getByTestId("thread-report");
    expect(event.getAttribute("data-outcome")).toBe("needs-you");
    expect(event.textContent).toContain("needs your call");
    expect(within(event).getByTestId("thread-chip").textContent).toBe("Fix login");
  });

  test("a message that arrives on the stream shows without a reload, and arriving twice shows once", async () => {
    const { fake } = setup({ fetches: [Promise.resolve([userMessage("u1", 1)])] });
    await settled();

    act(() => fake.entry(2, reply("a1", 2)));
    act(() => fake.entry(2, reply("a1", 2)));

    expect(screen.getAllByTestId("assistant-message")).toHaveLength(1);
  });

  test("while the coordinator works it says so, shows what it has written, and the reply takes that place", async () => {
    const { fake } = setup({
      fetches: [Promise.resolve([userMessage("u1", 1, { text: "Plan" })])],
    });
    await settled();
    expect(screen.getByTestId("coordinator-working").textContent).toContain(
      "Coordinator is working",
    );
    expect(screen.getByTestId("coordinator-chat-pane").getAttribute("data-working")).toBe("true");

    act(() => fake.delta("a1", "Looking at the open threads"));
    await waitFor(() =>
      expect(screen.getByTestId("coordinator-live-text").textContent).toContain("Looking at"),
    );

    act(() => fake.entry(2, reply("a1", 5, [{ type: "text", text: "Two threads are open." }])));

    expect(screen.queryByTestId("coordinator-activity")).toBeNull();
    expect(screen.getByTestId("assistant-message").textContent).toContain("Two threads are open.");
    expect(screen.getByTestId("coordinator-chat-pane").getAttribute("data-working")).toBe("false");
  });

  test("marks where the messages the person had not seen begin", async () => {
    const { seen } = setup({
      seen: { prj_1: at(2) },
      fetches: [
        Promise.resolve([
          userMessage("u1", 1),
          reply("a1", 2),
          reply("a2", 10, [{ type: "text", text: "While you were away" }]),
        ]),
      ],
    });
    await settled();

    const marker = screen.getByTestId("new-messages-marker");
    expect(marker.nextElementSibling?.textContent).toContain("While you were away");
    expect(seen.saved.prj_1).toBe(at(10));
  });

  test("no New line for a conversation this device has always kept up with", async () => {
    setup({
      seen: { prj_1: at(10) },
      fetches: [Promise.resolve([userMessage("u1", 1), reply("a1", 2)])],
    });
    await settled();

    expect(screen.queryByTestId("new-messages-marker")).toBeNull();
  });
});

describe("saying something", () => {
  test("Enter sends the text, clears the box, and the message shows at once", async () => {
    const { sent } = setup();
    await settled();

    type("  Start a thread on the login bug  ");
    pressEnter();
    await settled();

    expect(sent).toEqual(["Start a thread on the login bug"]);
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByTestId("user-message").textContent).toContain(
      "Start a thread on the login bug",
    );
  });

  test("the person's words are shown as typed, not read as markdown", async () => {
    setup({
      fetches: [
        Promise.resolve([
          userMessage("u1", 1, {
            text: "Tell [Fix login](thread:thr_1) it is **urgent**\n\nthanks",
          }),
        ]),
      ],
    });
    await settled();

    expect(screen.getByTestId("user-message-text").textContent).toBe(
      "Tell [Fix login](thread:thr_1) it is **urgent**\n\nthanks",
    );
  });

  test("sending takes the list to its end, even when the person had scrolled up", async () => {
    setup({ fetches: [Promise.resolve([userMessage("u1", 1), reply("a1", 2)])] });
    await settled();
    const scroller = screen.getByTestId("chat-scroll");
    const scrolledTo: unknown[] = [];
    scroller.scrollTo = ((options: ScrollToOptions) => {
      scrolledTo.push(options.top);
    }) as typeof scroller.scrollTo;

    type("one more thing");
    pressEnter();
    await settled();

    expect(scrolledTo).toContain(scroller.scrollHeight);
  });

  test("Shift+Enter is a new line and sends nothing; an empty box cannot send", async () => {
    const { sent } = setup();
    await settled();

    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);
    type("first line");
    fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Enter", shiftKey: true });

    expect(sent).toEqual([]);
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(false);
  });

  test("a send the host refuses gives the text back with the reason", async () => {
    setup({
      sendMessage: async () => {
        throw new Error("Project is paused");
      },
    });
    await settled();

    type("hello");
    fireEvent.click(screen.getByTestId("composer-send"));
    await settled();

    expect(screen.getByTestId("composer-error").textContent).toBe("Project is paused");
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe("hello");
  });

  test("what is typed and not sent is kept for the next visit", async () => {
    setup();
    await settled();

    type("half a thought");
    cleanup();
    setup();
    await settled();

    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe(
      "half a thought",
    );
  });
});

describe("an empty conversation", () => {
  test("explains the coordinator and offers messages to start with; choosing one sends it", async () => {
    const { sent } = setup({ project: makeProject({ id: "prj_1", goal: "Ship checkout v2" }) });
    await settled();

    expect(screen.getByTestId("chat-empty").textContent).toContain("Talk to the coordinator");
    const starters = screen.getAllByTestId("chat-starter");
    expect(starters.map((starter) => starter.textContent)).toContain(
      "Break the goal into threads: Ship checkout v2",
    );

    fireEvent.click(starters[0] as HTMLElement);
    await settled();

    expect(sent).toEqual(["What is the state of this project?"]);
    expect(screen.queryByTestId("chat-empty")).toBeNull();
  });

  test("a long goal is clamped on the text and not on the card, shows whole on hover, and is sent whole", async () => {
    const goal = `Keep checkout fast and boring ${"and make every page cheap to render, ".repeat(12)}done.`;
    expect(goal.length).toBeGreaterThan(300);
    const { sent } = setup({ project: makeProject({ id: "prj_1", goal }) });
    await settled();

    const card = screen.getAllByTestId("chat-starter")[2] as HTMLElement;
    const full = `Break the goal into threads: ${goal}`;
    expect(card.getAttribute("title")).toBe(full);
    // The clip belongs to the text inside the card's padding: on the card itself, the next line
    // would show through the bottom padding.
    expect(card.className).not.toContain("line-clamp");
    expect(card.firstElementChild?.className).toContain("line-clamp-2");
    expect(card.textContent).toBe(full);

    fireEvent.click(card);
    await settled();

    expect(sent).toEqual([full]);
  });
});

describe("a project that is not active", () => {
  test("a paused project says so, disables the box, and can be resumed from here", async () => {
    const paused = makeProject({ id: "prj_1", status: "paused" });
    net.respond = () => Response.json({ project: { ...paused, status: "active" } });
    const { stub } = setup({ project: paused, fetches: [Promise.resolve([userMessage("u1", 1)])] });
    await settled();

    expect(screen.getByTestId("chat-closed-notice").getAttribute("data-status")).toBe("paused");
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId("composer-send") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).placeholder).toContain(
      "Paused",
    );
    // A paused project has stopped working, so a message nobody answered is not "working".
    expect(screen.queryByTestId("coordinator-working")).toBeNull();

    fireEvent.click(screen.getByTestId("chat-closed-action"));
    await settled();

    expect(net.requests.at(-1)).toMatchObject({
      method: "POST",
      url: "/api/projects/prj_1/resume",
    });
    expect(stub.calls.adopted.at(-1)?.status).toBe("active");
  });

  test("an archived project offers to restore it and shows no starters", async () => {
    setup({ project: makeProject({ id: "prj_1", status: "archived" }) });
    await settled();

    expect(screen.getByTestId("chat-closed-action").textContent).toBe("Restore project");
    expect(screen.queryByTestId("chat-starter")).toBeNull();
  });
});
