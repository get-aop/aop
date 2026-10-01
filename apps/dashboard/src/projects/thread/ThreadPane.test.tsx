import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MessageDelta } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { delta, messageEntry, reply, userMessage } from "../chat/test-utils";
import { makeEntry, makeProject, makeState, makeThread, stubLiveProjects } from "../test-utils";
import { mockHost } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ThreadPane } = await import("./ThreadPane");
const { ProjectsProvider } = await import("../ProjectsProvider");
const { flush, setupPane } = await import("./pane-test-harness");

let host: ReturnType<typeof mockHost>;

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, "", "/projects/prj_1/threads/thr_1");
  host = mockHost();
});

afterEach(() => {
  cleanup();
  host.restore();
});

const inThread = { threadId: "thr_1" } as const;
const messagesRequests = () => host.to("/api/threads/thr_1/messages", "GET");

describe("a thread that is not there", () => {
  test("says it is loading while the project's threads are still coming", () => {
    render(
      <ThreadPane
        project={makeProject()}
        thread={undefined}
        threads={[]}
        threadsLoaded={false}
        threadsError={null}
      />,
    );

    expect(screen.getByTestId("thread-loading")).toBeTruthy();
    expect(screen.queryByTestId("thread-not-found")).toBeNull();
  });

  test("says why when fetching the project's threads failed, and fetches them again on Try again", () => {
    const project = makeProject({ id: "prj_1" });
    const stub = stubLiveProjects(makeState([makeEntry(project)]));
    render(
      <ProjectsProvider live={stub.live}>
        <ThreadPane
          project={project}
          thread={undefined}
          threads={[]}
          threadsLoaded={false}
          threadsError="Request failed (500)"
        />
      </ProjectsProvider>,
    );

    expect(screen.getByTestId("threads-error-message").textContent).toBe(
      "Could not load this thread: Request failed (500)",
    );
    expect(screen.queryByTestId("thread-loading")).toBeNull();
    expect(screen.queryByTestId("thread-not-found")).toBeNull();

    fireEvent.click(screen.getByTestId("threads-retry"));
    expect(stub.calls.refetched).toEqual(["prj_1"]);
  });

  test("says it is not found once they have come, with the way back", () => {
    render(
      <ThreadPane
        project={makeProject({ id: "prj_1" })}
        thread={undefined}
        threads={[]}
        threadsLoaded
        threadsError={null}
      />,
    );

    expect(screen.getByTestId("thread-not-found").textContent).toContain("Thread not found");
    expect(screen.queryByTestId("thread-loading")).toBeNull();
    expect(screen.getByText("Back to the project").getAttribute("href")).toBe("/projects/prj_1");
  });
});

describe("the transcript", () => {
  const brief = () =>
    reply(
      "m_brief",
      1,
      [
        { type: "quote-forwarded", text: "release moved to Monday" },
        { type: "text", text: "Redate the draft to Monday." },
      ],
      inThread,
    );

  test("loads the thread's own messages: the brief with its forwarded quote, the person's words, the agent's reply", async () => {
    await setupPane(host, {
      messages: [
        brief(),
        userMessage("u1", 2, { ...inThread, text: "Also fix the footer" }),
        reply("m_reply", 3, [{ type: "text", text: "Both done." }], inThread),
      ],
    });

    expect(await screen.findByTestId("quote-forwarded-text")).toBeTruthy();
    expect(screen.getByTestId("quote-forwarded-text").textContent).toBe("release moved to Monday");
    const text = screen.getByTestId("chat-scroll").textContent ?? "";
    expect(text).toContain("Redate the draft to Monday.");
    expect(text).toContain("Also fix the footer");
    expect(text).toContain("Both done.");
    expect(screen.getAllByTestId("user-message")).toHaveLength(1);
    expect(screen.getAllByTestId("assistant-message")).toHaveLength(2);
    expect(messagesRequests()).toHaveLength(1);
  });

  test("a thread nobody has spoken in says so", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", status: "idle" }), messages: [] });

    expect(await screen.findByTestId("thread-empty")).toBeTruthy();
  });

  test("a failed load says why and tries again", async () => {
    let attempts = 0;
    await setupPane(host, {
      answers: {
        "GET /api/threads/thr_1/messages": () => {
          attempts += 1;
          return Response.json({ error: "Host is restarting" }, { status: 503 });
        },
      },
    });

    expect((await screen.findByTestId("chat-error")).textContent).toContain("Host is restarting");
    fireEvent.click(screen.getByTestId("chat-retry"));
    await flush();

    expect(attempts).toBe(2);
  });

  test("the reply being written shows in its own row, and the finished message takes it over in place", async () => {
    const stream = await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
      messages: [brief()],
    });
    await screen.findByTestId("assistant-message");
    expect(screen.getByTestId("thread-working").textContent).toContain("is working");

    act(() =>
      stream.stub.emit({ kind: "delta", delta: delta("m_live", "Editing the header", inThread) }),
    );
    const liveRow = () =>
      screen
        .getAllByTestId("assistant-message")
        .find((row) => row.getAttribute("data-message-id") === "m_live");
    await waitFor(() => expect(liveRow()?.textContent).toContain("Editing"));
    const row = liveRow();

    act(() =>
      stream.stub.emit({
        kind: "entry",
        entry: messageEntry(
          1,
          reply("m_live", 5, [{ type: "text", text: "Header edited." }], inThread),
        ),
      }),
    );

    await flush();

    expect(liveRow()).toBe(row);
    await waitFor(() => expect(row?.textContent).toContain("Header edited."));
  });

  test("the reply being written shows its tool calls inline, live, where the agent made them", async () => {
    const stream = await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
      messages: [brief()],
    });
    await screen.findByTestId("assistant-message");

    act(() =>
      stream.stub.emit({ kind: "delta", delta: delta("m_live", "Running the tests.", inThread) }),
    );
    act(() =>
      stream.stub.emit({
        kind: "delta",
        delta: {
          ...delta("m_live", "", inThread),
          ops: [
            {
              op: "start",
              index: 1,
              part: { type: "tool", id: "t1", name: "Bash", detail: "bun test", status: "running" },
            },
          ],
        },
      }),
    );

    const call = await screen.findByTestId("tool-call");
    expect(call.getAttribute("data-status")).toBe("running");
    expect(call.textContent).toContain("bun test");
    expect(screen.getByTestId("thread-activity")).toBeTruthy();
  });

  test("a thread opened while its reply is being written shows the reply so far, at once", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
      messages: [brief()],
      // The project's stream told the page of the turn before the pane opened.
      heardBefore: [
        { kind: "delta", delta: delta("m_live", "Halfway through the header. ", inThread) },
      ],
    });

    const row = await screen.findByText("Halfway through the header.", { exact: false });
    expect(row).toBeTruthy();
  });

  // The person's report: a thread left and opened again mid-turn showed only its brief.
  test("a thread left and opened again mid-turn shows the turn so far, tool calls included, and goes on streaming", async () => {
    const other = makeThread({ id: "thr_2", projectId: "prj_1", status: "idle" });
    const stream = await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
      others: [other],
      messages: [brief()],
    });
    const turn = (ops: MessageDelta["ops"]) => ({
      kind: "delta" as const,
      delta: { ...delta("m_live", "", inThread), inReplyTo: "m_brief", ops },
    });
    const liveRow = () =>
      screen
        .queryAllByTestId("assistant-message")
        .find((row) => row.getAttribute("data-message-id") === "m_live");
    act(() => {
      stream.stub.emit(
        turn([
          { op: "start", index: 0, part: { type: "text", text: "Reading the header code. " } },
        ]),
      );
      stream.stub.emit(
        turn([
          {
            op: "start",
            index: 1,
            part: { type: "tool", id: "t1", name: "Read", detail: "Header.tsx", status: "running" },
          },
        ]),
      );
    });
    await waitFor(() => expect(liveRow()?.querySelector("[data-testid=tool-call]")).not.toBeNull());

    // Leave for the Overview while the turn goes on, then for another thread, then come back.
    await stream.showThread(null);
    act(() =>
      stream.stub.emit(turn([{ op: "tool", index: 1, status: "done", detail: "Header.tsx" }])),
    );
    await stream.showThread(other.id);
    expect(liveRow()).toBeUndefined();
    await stream.showThread("thr_1");

    // Everything so far is there at once, in the same render: not retyped from the first word.
    const row = liveRow();
    expect(row?.textContent).toContain("Reading the header code.");
    expect(row?.querySelector("[data-testid=tool-call]")?.getAttribute("data-status")).toBe("done");
    expect(screen.getByTestId("thread-working")).toBeTruthy();

    act(() =>
      stream.stub.emit(
        turn([{ op: "start", index: 2, part: { type: "text", text: "Fixed the header." } }]),
      ),
    );
    await waitFor(() => expect(liveRow()?.textContent).toContain("Fixed the header."));
    expect(liveRow()).toBe(row);
  });

  test("live text and messages of another thread or of the coordinator do not appear here", async () => {
    const stream = await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
      messages: [brief()],
    });
    await screen.findByTestId("assistant-message");

    act(() => {
      stream.stub.emit({
        kind: "delta",
        delta: delta("m_other", "Other thread text", { threadId: "thr_2" }),
      });
      stream.stub.emit({ kind: "delta", delta: delta("m_coord", "Coordinator text") });
      stream.stub.emit({
        kind: "entry",
        entry: messageEntry(
          1,
          reply("m_x", 5, [{ type: "text", text: "From thread two" }], { threadId: "thr_2" }),
        ),
      });
      stream.stub.emit({
        kind: "entry",
        entry: messageEntry(2, reply("m_y", 6, [{ type: "text", text: "From the coordinator" }])),
      });
    });
    await flush();

    const text = screen.getByTestId("chat-scroll").textContent ?? "";
    expect(text).not.toContain("Other thread text");
    expect(text).not.toContain("Coordinator text");
    expect(text).not.toContain("From thread two");
    expect(text).not.toContain("From the coordinator");
    expect(screen.getAllByTestId("assistant-message")).toHaveLength(1);
  });

  test("a resync refetches the transcript", async () => {
    const stream = await setupPane(host, { messages: [brief()] });
    await screen.findByTestId("assistant-message");
    stream.serveMessages([
      brief(),
      reply("m_late", 4, [{ type: "text", text: "Caught up." }], inThread),
    ]);

    act(() => stream.stub.emit({ kind: "resync", resync: { cursor: 3, reason: "trimmed" } }));

    expect(await screen.findByText("Caught up.")).toBeTruthy();
    expect(messagesRequests()).toHaveLength(2);
  });
});

describe("steering", () => {
  const type = (text: string) =>
    fireEvent.change(screen.getByTestId("composer-input"), { target: { value: text } });
  const pressEnter = () =>
    fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Enter" });

  test("posts the text to the thread's messages and reads the transcript again", async () => {
    const stream = await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "idle" }),
      messages: [userMessage("u0", 1, inThread)],
    });
    await screen.findByTestId("user-message");
    expect(screen.getByTestId("composer-input").getAttribute("placeholder")).toBe(
      "Steer this thread…",
    );
    stream.serveMessages([
      userMessage("u0", 1, inThread),
      userMessage("u1", 4, { ...inThread, text: "use the v2 endpoint" }),
    ]);

    type("use the v2 endpoint");
    pressEnter();
    await flush();

    expect(host.to("/api/threads/thr_1/messages", "POST")).toEqual([
      { method: "POST", url: "/api/threads/thr_1/messages", body: { text: "use the v2 endpoint" } },
    ]);
    expect(messagesRequests()).toHaveLength(2);
    expect(await screen.findByText("use the v2 endpoint")).toBeTruthy();
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe("");
  });

  test("a refused message gives the text back with the host's reason", async () => {
    await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "idle" }),
      answers: {
        "POST /api/threads/thr_1/messages": () =>
          Response.json(
            { error: "The project is paused", code: "PROJECT_NOT_ACTIVE" },
            { status: 409 },
          ),
      },
    });

    type("try again");
    pressEnter();
    await flush();

    expect(screen.getByTestId("composer-error").textContent).toBe("The project is paused");
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe("try again");
    expect(messagesRequests()).toHaveLength(1);
  });

  test("the box shows the model and effort the thread runs on", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", status: "idle" }) });

    expect(screen.getByTestId("thread-model").textContent).toBe("Opus 5");
    expect(screen.getByTestId("thread-effort").textContent).toBe("High");
  });

  test("a thread started on default says so instead of naming a model it never asked for", async () => {
    const runtime = { provider: "claude-code" as const, model: null, effort: null };
    await setupPane(host, { thread: makeThread({ id: "thr_1", status: "idle", runtime }) });

    expect(screen.getByTestId("thread-model").textContent).toBe("Default model");
    expect(screen.getByTestId("thread-effort").textContent).toBe("Default effort");
    expect(screen.getByTestId("thread-model").getAttribute("title")).toContain("Use default");
  });

  test("a thread that names only one of them shows the other as default", async () => {
    const runtime = { provider: "claude-code" as const, model: "claude-sonnet-4-6", effort: null };
    await setupPane(host, { thread: makeThread({ id: "thr_1", status: "idle", runtime }) });

    expect(screen.getByTestId("thread-model").textContent).toBe("Sonnet 4.6");
    expect(screen.getByTestId("thread-effort").textContent).toBe("Default effort");
  });

  test("a thread waiting on you shows its question, and an option answers through reply", async () => {
    await setupPane(host, {
      thread: {
        ...makeThread({ id: "thr_1", status: "waiting-on-you" }),
        blockedQuestion: {
          question: "Which database?",
          options: [
            { label: "Postgres", recommended: true },
            { label: "SQLite", recommended: false },
          ],
        },
      } as never,
    });

    expect(screen.getByTestId("answer-question").textContent).toBe("Which database?");
    expect(screen.queryByTestId("composer-stop")).toBeNull();
    fireEvent.click(screen.getAllByTestId("answer-option")[1] as HTMLElement);
    await flush();

    expect(host.to("/api/threads/thr_1/reply", "POST")).toEqual([
      { method: "POST", url: "/api/threads/thr_1/reply", body: { text: "SQLite" } },
    ]);
    expect(host.to("/api/threads/thr_1/messages", "POST")).toEqual([]);
  });
});

describe("stopping", () => {
  test.each(["working", "queued"] as const)(
    "a %s thread can be stopped with the button",
    async (status) => {
      await setupPane(host, { thread: makeThread({ id: "thr_1", status }) });

      fireEvent.click(screen.getByTestId("composer-stop"));
      await flush();

      expect(host.to("/api/threads/thr_1/stop", "POST")).toHaveLength(1);
    },
  );

  test.each(["working", "queued"] as const)(
    "and with Escape in the box when %s",
    async (status) => {
      await setupPane(host, { thread: makeThread({ id: "thr_1", status }) });

      fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Escape" });
      await flush();

      expect(host.to("/api/threads/thr_1/stop", "POST")).toHaveLength(1);
    },
  );

  test.each(["idle", "ready-for-review", "resolved", "rate-limited"] as const)(
    "a %s thread has nothing to stop: no button, and Escape does nothing",
    async (status) => {
      await setupPane(host, { thread: makeThread({ id: "thr_1", status }) });

      expect(screen.queryByTestId("composer-stop")).toBeNull();
      fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Escape" });
      await flush();

      expect(host.to("/api/threads/thr_1/stop", "POST")).toEqual([]);
    },
  );

  test("the button appears when the thread starts working and goes when it stops", async () => {
    const stream = await setupPane(host, { thread: makeThread({ id: "thr_1", status: "idle" }) });
    expect(screen.queryByTestId("composer-stop")).toBeNull();

    await stream.setThread(makeThread({ id: "thr_1", status: "working" }));
    expect(screen.getByTestId("composer-stop")).toBeTruthy();

    await stream.setThread(makeThread({ id: "thr_1", status: "idle" }));
    expect(screen.queryByTestId("composer-stop")).toBeNull();
  });
});

describe("when the box cannot be used", () => {
  test("a thread that is landing takes no message, and says why", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", status: "landing" }) });

    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("placeholder")).toBe(
      "Merging the pull request. The thread takes no message until it is done.",
    );
    expect(screen.getByTestId("thread-notice-landing")).toBeTruthy();
  });

  test("a paused project's threads take no message, and the notice offers the way back", async () => {
    await setupPane(host, {
      project: makeProject({ id: "prj_1", status: "paused" }),
      thread: makeThread({ id: "thr_1", status: "idle" }),
    });

    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(input.getAttribute("placeholder")).toBe(
      "Paused. Resume the project to message this thread.",
    );
    expect(screen.getByTestId("chat-closed-notice").getAttribute("data-status")).toBe("paused");
  });

  test("an archived project's threads take no message either", async () => {
    await setupPane(host, { project: makeProject({ id: "prj_1", status: "archived" }) });

    expect(
      (screen.getByTestId("composer-input") as HTMLTextAreaElement).getAttribute("placeholder"),
    ).toBe("Archived. Restore the project to message this thread.");
  });
});
