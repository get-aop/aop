import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MessageBlock, Thread } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { ChatProvider } = await import("./chat-context");
const { MessageBlocks } = await import("./MessageBlocks");

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/");
});
afterEach(cleanup);

const fixLogin = makeThread({ id: "thr_1", title: "Fix login", status: "working" });
const audit = makeThread({ id: "thr_2", title: "Audit retries", status: "idle" });

const tree = (blocks: MessageBlock[], threads: Thread[], threadsLoaded = true) => (
  <ChatProvider projectId="prj_1" projectActive threads={threads} threadsLoaded={threadsLoaded}>
    <MessageBlocks blocks={blocks} />
  </ChatProvider>
);

const renderBlocks = (
  blocks: MessageBlock[],
  threads: Thread[] = [fixLogin, audit],
  loaded = true,
) => render(tree(blocks, threads, loaded));

describe("prose and chips", () => {
  test("a chip in the middle of a sentence stays inside its paragraph, and opens its thread", () => {
    const { container } = renderBlocks([
      { type: "text", text: "Sent your note to " },
      { type: "thread-chip", threadId: "thr_1" },
      { type: "text", text: "; it will redate the draft." },
    ]);

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    const chip = within(paragraphs[0] as HTMLElement).getByTestId("thread-chip");
    expect(chip.textContent).toBe("Fix login");
    expect(chip.getAttribute("href")).toBe("/projects/prj_1/threads/thr_1");
    expect(chip.getAttribute("data-status")).toBe("working");
    expect(paragraphs[0]?.textContent).toBe(
      "Sent your note to Fix login; it will redate the draft.",
    );
  });

  test("a pull request chip shows its number, coloured by state, and links to it", () => {
    renderBlocks([
      { type: "text", text: "It is up as " },
      {
        type: "pr-chip",
        number: 4821,
        url: "https://github.com/acme/app/pull/4821",
        state: "merged",
      },
      { type: "text", text: "." },
    ]);

    const chip = screen.getByTestId("pr-chip");
    expect(chip.textContent).toBe("#4821");
    expect(chip.getAttribute("href")).toBe("https://github.com/acme/app/pull/4821");
    expect(chip.getAttribute("data-state")).toBe("merged");
  });

  test("a chip for a thread that is gone says so, and one for a thread not loaded yet says it is coming", () => {
    const { unmount } = renderBlocks([{ type: "thread-chip", threadId: "gone" }]);
    expect(screen.getByTestId("thread-chip-missing").textContent).toBe("Deleted thread");
    unmount();

    renderBlocks([{ type: "thread-chip", threadId: "gone" }], [], false);
    expect(screen.getByTestId("thread-chip-missing").textContent).toBe("Thread");
  });

  test("a chip follows its thread when the thread changes", () => {
    const { rerender } = renderBlocks([{ type: "thread-chip", threadId: "thr_1" }]);
    expect(screen.getByTestId("thread-chip").getAttribute("data-status")).toBe("working");

    rerender(
      tree(
        [{ type: "thread-chip", threadId: "thr_1" }],
        [makeThread({ id: "thr_1", title: "Fix login redirect", status: "idle" })],
      ),
    );

    expect(screen.getByTestId("thread-chip").textContent).toBe("Fix login redirect");
    expect(screen.getByTestId("thread-chip").getAttribute("data-status")).toBe("idle");
  });
});

describe("routing receipt", () => {
  test("says how many threads a reply reached, and names the ones that have no card of their own", () => {
    renderBlocks([
      { type: "text", text: "Passed it on." },
      { type: "routing-receipt", threadIds: ["thr_1", "thr_2"] },
      { type: "thread-card", threadId: "thr_2", variant: "live" },
    ]);

    const receipt = screen.getByTestId("routing-receipt");
    expect(receipt.getAttribute("data-thread-count")).toBe("2");
    expect(receipt.textContent).toContain("Sent to 2 threads");
    expect(
      within(receipt)
        .getAllByTestId("thread-chip")
        .map((chip) => chip.textContent),
    ).toEqual(["Fix login"]);
  });

  test("reads 'Sent to one thread' for one, and leads the message", () => {
    const { container } = renderBlocks([
      { type: "text", text: "Passed it on." },
      { type: "routing-receipt", threadIds: ["thr_1"] },
    ]);

    expect(screen.getByTestId("routing-receipt").textContent).toContain("Sent to one thread");
    const blocks = container.querySelector("[data-testid=message-blocks]");
    expect(blocks?.firstElementChild?.getAttribute("data-testid")).toBe("routing-receipt");
  });
});

describe("thread card", () => {
  const cardOf = (threadId: string) =>
    screen.getByTestId("chat-thread-card").getAttribute("data-thread-id") === threadId;

  test("a live thread shows its status line and steps, and the whole card opens the thread", () => {
    const working = makeThread({
      id: "thr_1",
      title: "Fix login",
      status: "working",
      liveStatusLine: "Bisecting · 7 commits left",
      steps: [
        { label: "Reproduce", state: "done" },
        { label: "Bisect", state: "active" },
        { label: "Fix", state: "pending" },
      ],
    });
    renderBlocks([{ type: "thread-card", threadId: "thr_1", variant: "live" }], [working]);

    expect(cardOf("thr_1")).toBe(true);
    expect(screen.getByTestId("chat-thread-card").getAttribute("data-variant")).toBe("live");
    expect(screen.getByTestId("chat-thread-card-status").textContent).toBe(
      "Bisecting · 7 commits left",
    );
    expect(screen.getByTestId("thread-steps").textContent).toBe("1/3");
    expect(screen.getByTestId("chat-thread-card-link").getAttribute("href")).toBe(
      "/projects/prj_1/threads/thr_1",
    );
  });

  test("a thread that needs the person's call shows the question, the options and View thread", () => {
    const blocked = {
      ...makeThread({ id: "thr_1", title: "Pick a database", status: "waiting-on-you" }),
      blockedQuestion: {
        question: "Which database?",
        options: [
          { label: "Postgres", recommended: true },
          { label: "SQLite", recommended: false },
        ],
      },
    } as Thread;
    renderBlocks([{ type: "thread-card", threadId: "thr_1", variant: "needs-call" }], [blocked]);

    expect(screen.getByTestId("chat-thread-card").getAttribute("data-variant")).toBe("needs-call");
    expect(screen.getByTestId("chat-thread-card-question").textContent).toBe("Which database?");
    expect(screen.getByTestId("chat-thread-card-options").textContent).toBe(
      "Reply with: Postgres (recommended), or SQLite",
    );
    const view = screen.getByTestId("chat-thread-card-view");
    expect(view.textContent).toBe("View thread");
    expect(view.getAttribute("href")).toBe("/projects/prj_1/threads/thr_1");

    fireEvent.click(view);
    expect(window.location.pathname).toBe("/projects/prj_1/threads/thr_1");
  });

  test("a finished thread shows its pull request", () => {
    const done = makeThread({
      id: "thr_1",
      title: "Fix login",
      status: "ready-for-review",
      liveStatusLine: "PR is up",
      artifacts: [
        { type: "pr", number: 4821, url: "https://github.com/acme/app/pull/4821", state: "open" },
      ],
    });
    renderBlocks([{ type: "thread-card", threadId: "thr_1", variant: "done" }], [done]);

    expect(screen.getByTestId("chat-thread-card").getAttribute("data-variant")).toBe("done");
    expect(screen.getByTestId("chat-thread-card-pr").textContent).toBe("#4821");
  });

  test("updates in place: the card the coordinator posted as a call turns live when the person answers, then done", () => {
    const blocks: MessageBlock[] = [
      { type: "thread-card", threadId: "thr_1", variant: "needs-call" },
    ];
    const waiting = makeThread({ id: "thr_1", title: "Pick a database", status: "waiting-on-you" });
    const { rerender } = render(tree(blocks, [waiting]));
    const card = screen.getByTestId("chat-thread-card");
    expect(card.getAttribute("data-variant")).toBe("needs-call");

    rerender(
      tree(blocks, [{ ...waiting, status: "working", liveStatusLine: "Migrating" } as Thread]),
    );
    expect(screen.getByTestId("chat-thread-card")).toBe(card);
    expect(card.getAttribute("data-variant")).toBe("live");
    expect(screen.queryByTestId("chat-thread-card-question")).toBeNull();

    rerender(tree(blocks, [{ ...waiting, status: "idle" } as Thread]));
    expect(card.getAttribute("data-variant")).toBe("done");
  });

  test("says when the thread is still loading or is gone", () => {
    const blocks: MessageBlock[] = [{ type: "thread-card", threadId: "thr_9", variant: "live" }];
    const { unmount } = renderBlocks(blocks, [], false);
    expect(screen.getByTestId("chat-thread-card-unavailable").textContent).toBe("Loading thread…");
    unmount();

    renderBlocks(blocks, [], true);
    expect(screen.getByTestId("chat-thread-card-unavailable").textContent).toBe(
      "This thread no longer exists.",
    );
  });
});

describe("forwarded quote", () => {
  test("shows what the person said, under the label the thread reads", () => {
    renderBlocks([
      { type: "quote-forwarded", text: "release moved to Monday" },
      { type: "text", text: "Redate the draft." },
    ]);

    expect(screen.getByTestId("quote-forwarded").textContent).toContain(
      "Message forwarded from project chat",
    );
    expect(screen.getByTestId("quote-forwarded-text").textContent).toBe("release moved to Monday");
  });
});

describe("a block the app does not know", () => {
  test("is left out and the rest of the message still shows", async () => {
    renderBlocks([
      { type: "text", text: "Hello." },
      { type: "delegation-card" } as unknown as MessageBlock,
    ]);
    await act(async () => {});

    expect(screen.getByTestId("message-blocks").textContent).toContain("Hello.");
  });
});
