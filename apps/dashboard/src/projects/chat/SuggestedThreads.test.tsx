import { afterEach, describe, expect, test } from "bun:test";
import type { SuggestedThread, Thread } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeThread } from "../test-utils";
import type { ChatApi } from "./chat-api";
import { createSuggestionStore, type SuggestionStore } from "./suggestion-store";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ChatApiProvider } = await import("./chat-api");
const { ChatProvider } = await import("./chat-context");
const { SuggestedThreads } = await import("./SuggestedThreads");

afterEach(cleanup);

const suggestions: SuggestedThread[] = [
  { id: "s1", title: "Add retry metrics", prompt: "Add metrics to every retry", repoId: null },
  { id: "s2", title: "Load test", prompt: "Load test checkout", repoId: "repo_1" },
];

const memoryStore = (): SuggestionStore => {
  let saved: string | null = null;
  return createSuggestionStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
};

interface Setup {
  started: Parameters<ChatApi["startThread"]>[];
  store: SuggestionStore;
  rerender: (threads: Thread[], active?: boolean) => void;
}

const setup = (
  options: {
    fail?: (title: string) => string | null;
    active?: boolean;
    store?: SuggestionStore;
  } = {},
): Setup => {
  const started: Setup["started"] = [];
  const store = options.store ?? memoryStore();
  const api: ChatApi = {
    listMessages: async () => [],
    sendMessage: async () => {
      throw new Error("not used");
    },
    startThread: async (projectId, suggestion) => {
      started.push([projectId, suggestion]);
      const failure = options.fail?.(suggestion.title);
      if (failure) throw new Error(failure);
      return makeThread({ id: `thr_${suggestion.id}`, title: suggestion.title });
    },
  };
  const tree = (threads: Thread[], active: boolean) => (
    <ChatApiProvider value={api}>
      <ChatProvider projectId="prj_1" projectActive={active} threads={threads} threadsLoaded>
        <SuggestedThreads suggestions={suggestions} store={store} />
      </ChatProvider>
    </ChatApiProvider>
  );
  const { rerender } = render(tree([], options.active ?? true));
  return { started, store, rerender: (threads, active = true) => rerender(tree(threads, active)) };
};

const row = (id: string) =>
  screen
    .getAllByTestId("suggestion")
    .find((element) => element.getAttribute("data-suggestion-id") === id) as HTMLElement;

describe("SuggestedThreads", () => {
  test("lists each proposal with its title and brief, waiting for an answer, and starts nothing by itself", () => {
    const { started } = setup();

    expect(screen.getAllByTestId("suggestion-title").map((title) => title.textContent)).toEqual([
      "Add retry metrics",
      "Load test",
    ]);
    expect(row("s1").getAttribute("data-state")).toBe("pending");
    expect(started).toEqual([]);
  });

  test("Start starts that suggestion as a thread with its brief and repo, and the row then names the thread", async () => {
    const { started, rerender } = setup();

    fireEvent.click(within(row("s2")).getByTestId("suggestion-start"));

    await waitFor(() => expect(row("s2").getAttribute("data-state")).toBe("started"));
    expect(started).toEqual([["prj_1", suggestions[1] as SuggestedThread]]);
    expect(row("s1").getAttribute("data-state")).toBe("pending");

    rerender([makeThread({ id: "thr_s2", title: "Load test" })]);
    expect(within(row("s2")).getByTestId("thread-chip").textContent).toBe("Load test");
    expect(within(row("s2")).queryByTestId("suggestion-start")).toBeNull();
  });

  test("Skip dismisses one suggestion without starting anything, and Undo brings it back", () => {
    const { started } = setup();

    fireEvent.click(within(row("s1")).getByTestId("suggestion-skip"));
    expect(row("s1").getAttribute("data-state")).toBe("skipped");
    expect(started).toEqual([]);

    fireEvent.click(within(row("s1")).getByTestId("suggestion-undo"));
    expect(row("s1").getAttribute("data-state")).toBe("pending");
  });

  test("Start all starts what is still waiting, one after the other, in the order proposed", async () => {
    const { started } = setup();
    fireEvent.click(within(row("s1")).getByTestId("suggestion-skip"));
    expect(screen.queryByTestId("suggestions-start-all")).toBeNull();
    fireEvent.click(within(row("s1")).getByTestId("suggestion-undo"));

    fireEvent.click(screen.getByTestId("suggestions-start-all"));

    await waitFor(() => expect(row("s2").getAttribute("data-state")).toBe("started"));
    expect(started.map(([, suggestion]) => suggestion.title)).toEqual([
      "Add retry metrics",
      "Load test",
    ]);
    expect(row("s1").getAttribute("data-state")).toBe("started");
    expect(screen.queryByTestId("suggestions-start-all")).toBeNull();
  });

  test("a start the host refuses says why and stays waiting, so it can be tried again", async () => {
    let refuse = true;
    const { started } = setup({ fail: () => (refuse ? "Project has several repositories" : null) });

    fireEvent.click(within(row("s1")).getByTestId("suggestion-start"));

    await waitFor(() =>
      expect(within(row("s1")).getByTestId("suggestion-error").textContent).toBe(
        "Project has several repositories",
      ),
    );
    expect(row("s1").getAttribute("data-state")).toBe("pending");

    refuse = false;
    fireEvent.click(within(row("s1")).getByTestId("suggestion-start"));
    await waitFor(() => expect(row("s1").getAttribute("data-state")).toBe("started"));
    expect(within(row("s1")).queryByTestId("suggestion-error")).toBeNull();
    expect(started).toHaveLength(2);
  });

  test("while the project is paused nothing can be started", () => {
    setup({ active: false });

    expect((within(row("s1")).getByTestId("suggestion-start") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId("suggestions-start-all") as HTMLButtonElement).disabled).toBe(true);
  });

  test("what was answered survives a reload: a new render over the same store shows it", async () => {
    const store = memoryStore();
    setup({ store });
    fireEvent.click(within(row("s1")).getByTestId("suggestion-skip"));
    await act(async () => {});
    cleanup();

    setup({ store });

    expect(row("s1").getAttribute("data-state")).toBe("skipped");
    expect(row("s2").getAttribute("data-state")).toBe("pending");
  });
});
