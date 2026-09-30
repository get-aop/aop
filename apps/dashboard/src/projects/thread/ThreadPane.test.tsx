import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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

describe("the header", () => {
  test("shows the title, the status, the branch and the repository by name", async () => {
    await setupPane(host, {
      thread: makeThread({
        id: "thr_1",
        title: "Fix 4s cold start regression",
        status: "idle",
        branch: "aop/fix-cold-start-ab12cd",
      }),
    });

    expect(screen.getByTestId("thread-title").textContent).toBe("Fix 4s cold start regression");
    expect(screen.getByTestId("thread-status").textContent).toBe("Idle");
    expect(screen.getByTestId("thread-branch").textContent).toBe("aop/fix-cold-start-ab12cd");
    expect(screen.getByTestId("thread-repo").textContent).toBe("checkout");
  });

  test("a repository the host does not list is shown by its id", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", repoId: "repo_gone" }) });

    expect(screen.getByTestId("thread-repo").textContent).toBe("repo_gone");
  });

  test("the way back leads to the project's threads without a page load", async () => {
    await setupPane(host);

    const back = screen.getByTestId("thread-back");
    expect(back.getAttribute("href")).toBe("/projects/prj_1");
    fireEvent.click(back);
    expect(window.location.pathname).toBe("/projects/prj_1");
  });

  test("a thread waiting on you says so in the attention colour", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", status: "waiting-on-you" }) });

    expect(screen.getByTestId("thread-status").textContent).toBe("Waiting on you");
    expect(screen.getByTestId("thread-status").className).toContain("text-waiting");
    expect(screen.getByTestId("thread-pane").getAttribute("data-status")).toBe("waiting-on-you");
  });

  test("a thread with no repository has no repository, branch, changes tab or pull request bar", async () => {
    await setupPane(host, { thread: makeThread({ id: "thr_1", repoId: null, branch: null }) });

    expect(screen.queryByTestId("thread-repo")).toBeNull();
    expect(screen.queryByTestId("thread-branch")).toBeNull();
    expect(screen.queryByTestId("thread-tab-changes")).toBeNull();
    expect(screen.queryByTestId("pr-bar")).toBeNull();
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

  test("the reply being written shows as live text, and the finished message takes its place", async () => {
    const stream = await setupPane(host, {
      thread: makeThread({ id: "thr_1", status: "working" }),
      messages: [brief()],
    });
    await screen.findByTestId("assistant-message");
    expect(screen.getByTestId("thread-working").textContent).toContain("is working");

    act(() =>
      stream.stub.emit({ kind: "delta", delta: delta("m_live", "Editing the header", inThread) }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("thread-live-text").textContent).toContain("Editing"),
    );

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

    expect(screen.queryByTestId("thread-live-text")).toBeNull();
    expect(screen.getAllByTestId("assistant-message").at(-1)?.textContent).toContain(
      "Header edited.",
    );
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

    expect(screen.queryByTestId("thread-live-text")).toBeNull();
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
  test.each(["working", "queued", "rate-limited"] as const)(
    "a %s thread can be stopped with the button",
    async (status) => {
      await setupPane(host, { thread: makeThread({ id: "thr_1", status }) });

      fireEvent.click(screen.getByTestId("composer-stop"));
      await flush();

      expect(host.to("/api/threads/thr_1/stop", "POST")).toHaveLength(1);
    },
  );

  test.each(["working", "queued", "rate-limited"] as const)(
    "and with Escape in the box when %s",
    async (status) => {
      await setupPane(host, { thread: makeThread({ id: "thr_1", status }) });

      fireEvent.keyDown(screen.getByTestId("composer-input"), { key: "Escape" });
      await flush();

      expect(host.to("/api/threads/thr_1/stop", "POST")).toHaveLength(1);
    },
  );

  test.each(["idle", "ready-for-review", "resolved"] as const)(
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
