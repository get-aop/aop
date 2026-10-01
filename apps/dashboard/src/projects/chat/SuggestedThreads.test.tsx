import { afterEach, describe, expect, test } from "bun:test";
import type { SuggestedThread, SuggestionAnswer, Thread } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";
import type { ChatApi } from "./chat-api";
import { page } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ChatApiProvider } = await import("./chat-api");
const { ChatProvider } = await import("./chat-context");
const { SuggestedThreads } = await import("./SuggestedThreads");

afterEach(cleanup);

const proposals: SuggestedThread[] = [
  {
    id: "s1",
    title: "Add retry metrics",
    prompt: "Add metrics to every retry",
    reason: "Nobody can tell how often a retry fires.",
    repoId: null,
  },
  { id: "s2", title: "Load test", prompt: "Load test checkout", repoId: "repo_1" },
];

type Call = [action: "start" | "skip" | "unskip", projectId: string, messageId: string, id: string];

interface Setup {
  calls: Call[];
  /** What the stream would do: the host publishes the message again with these answers. */
  answers: (answers: Record<string, SuggestionAnswer>, threads?: Thread[]) => void;
  release: () => void;
}

const setup = (
  options: {
    fail?: (action: Call[0], id: string) => string | null;
    active?: boolean;
    hold?: boolean;
    answers?: Record<string, SuggestionAnswer>;
  } = {},
): Setup => {
  const calls: Call[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const respond = async (action: Call[0], projectId: string, messageId: string, id: string) => {
    calls.push([action, projectId, messageId, id]);
    if (options.hold && action === "start") await held;
    const failure = options.fail?.(action, id);
    if (failure) throw new Error(failure);
  };
  const api: ChatApi = {
    listMessages: async () => page([]),
    sendMessage: async () => {
      throw new Error("not used");
    },
    startSuggestion: async (projectId, messageId, id) => {
      await respond("start", projectId, messageId, id);
      return makeThread({ id: `thr_${id}` });
    },
    skipSuggestion: (projectId, messageId, id) => respond("skip", projectId, messageId, id),
    unskipSuggestion: (projectId, messageId, id) => respond("unskip", projectId, messageId, id),
  };
  const tree = (answered: Record<string, SuggestionAnswer>, threads: Thread[]) => (
    <ChatApiProvider value={api}>
      <ChatProvider
        projectId="prj_1"
        projectActive={options.active ?? true}
        threads={threads}
        threadsLoaded
        threadsError={null}
      >
        <SuggestedThreads
          messageId="msg_1"
          suggestions={proposals.map((proposal) => ({
            ...proposal,
            answer: answered[proposal.id],
          }))}
        />
      </ChatProvider>
    </ChatApiProvider>
  );
  const { rerender } = render(tree(options.answers ?? {}, []));
  return {
    calls,
    answers: (answered, threads = []) => rerender(tree(answered, threads)),
    release,
  };
};

const row = (id: string) =>
  screen
    .getAllByTestId("suggestion")
    .find((element) => element.getAttribute("data-suggestion-id") === id) as HTMLElement;

const stateOf = (id: string) => row(id).getAttribute("data-state");

describe("SuggestedThreads", () => {
  test("lists each proposal with its title and its reason, never the brief, waiting for an answer, and asks the host for nothing by itself", () => {
    const { calls } = setup();

    expect(screen.getAllByTestId("suggestion-title").map((title) => title.textContent)).toEqual([
      "Add retry metrics",
      "Load test",
    ]);
    expect(within(row("s1")).getByTestId("suggestion-reason").textContent).toBe(
      "Nobody can tell how often a retry fires.",
    );
    // A proposal stored before reasons existed shows its title alone.
    expect(within(row("s2")).queryByTestId("suggestion-reason")).toBeNull();
    expect(screen.queryByText("Add metrics to every retry")).toBeNull();
    expect(stateOf("s1")).toBe("pending");
    expect(calls).toEqual([]);
  });

  test("each row starts with an icon button named for it, and one button starts the rows still waiting, counting them", () => {
    const { answers } = setup();

    expect(within(row("s1")).getByTestId("suggestion-start").getAttribute("aria-label")).toBe(
      "Start Add retry metrics",
    );
    expect(within(row("s1")).getByTestId("suggestion-start").textContent).toBe("");
    expect(screen.getByTestId("suggestions-start-all").textContent).toBe("Start 2 threads");

    answers({ s1: { state: "skipped" } });
    expect(screen.getByTestId("suggestions-start-all").textContent).toBe("Start 1 thread");

    answers({ s1: { state: "skipped" }, s2: { state: "started", threadId: "thr_s2" } });
    expect(screen.queryByTestId("suggestions-start-all")).toBeNull();
  });

  test("Skip is a quiet control: hidden until the row is hovered or focused, except on a touch screen", () => {
    setup();

    const skip = within(row("s1")).getByTestId("suggestion-skip");
    expect(skip.className).toContain("opacity-0");
    expect(skip.className).toContain("group-hover/suggestion:opacity-100");
    expect(skip.className).toContain("group-focus-within/suggestion:opacity-100");
    expect(skip.className).toContain("pointer-coarse:opacity-100");
  });

  test("Start asks the host to start that suggestion of that message, and the row names the thread once the host says so", async () => {
    const { calls, answers } = setup();

    fireEvent.click(within(row("s2")).getByTestId("suggestion-start"));

    await waitFor(() => expect(calls).toEqual([["start", "prj_1", "msg_1", "s2"]]));
    answers({ s2: { state: "started", threadId: "thr_s2" } }, [
      makeThread({ id: "thr_s2", title: "Load test" }),
    ]);
    expect(stateOf("s2")).toBe("started");
    expect(stateOf("s1")).toBe("pending");
    expect(within(row("s2")).getByTestId("thread-chip").textContent).toBe("Load test");
    expect(within(row("s2")).queryByTestId("suggestion-start")).toBeNull();
  });

  test("a row says Starting… while the host works, and is not marked started until the host says it is", async () => {
    const { release } = setup({ hold: true });

    fireEvent.click(within(row("s1")).getByTestId("suggestion-start"));

    await waitFor(() => expect(stateOf("s1")).toBe("starting"));
    const busy = within(row("s1")).getByTestId("suggestion-start");
    expect(busy.getAttribute("aria-label")).toBe("Starting Add retry metrics");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    await act(async () => release());
    await waitFor(() => expect(stateOf("s1")).toBe("pending"));
  });

  test("answers the host already holds show on first render, which is how a second device sees them", () => {
    setup({
      answers: { s1: { state: "skipped" }, s2: { state: "started", threadId: "thr_s2" } },
    });

    expect(stateOf("s1")).toBe("skipped");
    expect(stateOf("s2")).toBe("started");
    expect(within(row("s1")).getByTestId("suggestion-undo")).toBeTruthy();
    expect(screen.queryByTestId("suggestions-start-all")).toBeNull();
  });

  test("an answer this browser once kept in local storage counts for nothing", () => {
    window.localStorage.setItem(
      "aop:suggestion-resolutions:v1",
      JSON.stringify({ s1: { state: "started", threadId: "thr_old" } }),
    );

    setup();

    expect(stateOf("s1")).toBe("pending");
    window.localStorage.clear();
  });

  test("Skip and Undo ask the host, and the row follows the answer that comes back", async () => {
    const { calls, answers } = setup();

    fireEvent.click(within(row("s1")).getByTestId("suggestion-skip"));
    await waitFor(() => expect(calls).toEqual([["skip", "prj_1", "msg_1", "s1"]]));
    expect(stateOf("s1")).toBe("pending");
    answers({ s1: { state: "skipped" } });
    expect(stateOf("s1")).toBe("skipped");

    fireEvent.click(within(row("s1")).getByTestId("suggestion-undo"));
    await waitFor(() => expect(calls.at(-1)).toEqual(["unskip", "prj_1", "msg_1", "s1"]));
    answers({});
    expect(stateOf("s1")).toBe("pending");
  });

  test("Start N threads starts what is still waiting, one after the other, in the order proposed", async () => {
    const { calls, answers } = setup({ answers: { s1: { state: "skipped" } } });
    expect(screen.getByTestId("suggestions-start-all").textContent).toBe("Start 1 thread");
    answers({});

    fireEvent.click(screen.getByTestId("suggestions-start-all"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map(([, , , id]) => id)).toEqual(["s1", "s2"]);
  });

  test("a start the host refuses says why and stays waiting, so it can be tried again", async () => {
    let refuse = true;
    const { calls } = setup({
      fail: (action) => (action === "start" && refuse ? "Project has several repositories" : null),
    });

    fireEvent.click(within(row("s1")).getByTestId("suggestion-start"));

    await waitFor(() =>
      expect(within(row("s1")).getByTestId("suggestion-error").textContent).toBe(
        "Project has several repositories",
      ),
    );
    expect(stateOf("s1")).toBe("pending");

    refuse = false;
    fireEvent.click(within(row("s1")).getByTestId("suggestion-start"));
    await waitFor(() => expect(within(row("s1")).queryByTestId("suggestion-error")).toBeNull());
    expect(calls).toHaveLength(2);
  });

  test("a skip the host does not take says why", async () => {
    setup({ fail: () => "Could not reach the host" });

    fireEvent.click(within(row("s2")).getByTestId("suggestion-skip"));

    await waitFor(() =>
      expect(within(row("s2")).getByTestId("suggestion-error").textContent).toBe(
        "Could not reach the host",
      ),
    );
    expect(stateOf("s2")).toBe("pending");
  });

  test("while the project is paused nothing can be started", () => {
    setup({ active: false });

    expect((within(row("s1")).getByTestId("suggestion-start") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId("suggestions-start-all") as HTMLButtonElement).disabled).toBe(true);
  });
});
