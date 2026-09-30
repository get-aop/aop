import { describe, expect, test } from "bun:test";
import type { Message } from "@aop/common";
import type { ChatState } from "./chat-state";
import { type Conversation, createConversation, FETCH_RETRY_MS } from "./conversation";
import {
  createFakeEvents,
  deferred,
  delta,
  ids,
  messageEntry,
  reply,
  userMessage,
} from "./test-utils";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const THREAD = "thr_1";
const inThread = (id: string, seconds: number, threadId: string = THREAD) =>
  reply(id, seconds, undefined, { threadId });
const steer = (id: string, seconds: number, threadId: string = THREAD) =>
  userMessage(id, seconds, { threadId });

/** A thread's conversation over a fake host: `fetches` are the answers the next fetches give, in order. */
const setup = (options: { fetches?: Promise<Message[]>[]; scope?: string | null } = {}) => {
  const fake = createFakeEvents();
  const pending = [...(options.fetches ?? [])];
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  const loaded: ChatState[] = [];
  let fetchCount = 0;
  const conversation = createConversation({
    projectId: "prj_1",
    scope: options.scope === undefined ? THREAD : options.scope,
    listMessages: () => {
      fetchCount += 1;
      return pending.shift() ?? Promise.resolve([]);
    },
    events: fake.events,
    schedule: (run, delayMs) => {
      const timer = { run, delayMs, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onLoaded: (state) => loaded.push(state),
  });
  return { conversation, fake, timers, loaded, fetches: () => fetchCount };
};

const held = (conversation: Conversation) => ids(conversation.getState().messages);
const entryOf = (id: number, message: Message) => ({
  kind: "entry" as const,
  entry: messageEntry(id, message),
});
const threadDelta = (messageId: string, text: string, replace = false, threadId = THREAD) => ({
  kind: "delta" as const,
  delta: delta(messageId, text, { threadId, replace }),
});

describe("loading a thread's conversation", () => {
  test("listens to the stream first, then holds what the host lists: its own thread's messages only", async () => {
    const { conversation, fake } = setup({
      fetches: [
        Promise.resolve([
          inThread("brief", 1),
          steer("steer", 2),
          inThread("other", 3, "thr_2"),
          userMessage("coordinator", 4),
        ]),
      ],
    });

    conversation.start();
    expect(fake.listenerCount()).toBe(2);
    expect(conversation.getState().phase).toBe("loading");
    await flush();

    expect(conversation.getState().phase).toBe("ready");
    expect(conversation.getState().scope).toBe(THREAD);
    expect(held(conversation)).toEqual(["brief", "steer"]);
  });

  test("tells its subscribers when it changes, and stops when they leave", async () => {
    const { conversation } = setup({ fetches: [Promise.resolve([inThread("a1", 1)])] });
    let calls = 0;
    const unsubscribe = conversation.subscribe(() => {
      calls += 1;
    });

    conversation.start();
    await flush();
    expect(calls).toBe(1);

    unsubscribe();
    conversation.receive(inThread("a2", 2));
    expect(calls).toBe(1);
  });

  test("hands the state a fetch produced to onLoaded, after every successful fetch", async () => {
    const { conversation, fake, loaded } = setup({
      fetches: [
        Promise.resolve([inThread("a1", 1)]),
        Promise.resolve([inThread("a1", 1), inThread("a2", 2)]),
      ],
    });

    conversation.start();
    await flush();
    expect(loaded.map((state) => ids(state.messages))).toEqual([["a1"]]);

    fake.resync();
    await flush();

    expect(loaded.map((state) => ids(state.messages))).toEqual([["a1"], ["a1", "a2"]]);
    expect(loaded.at(-1)).toBe(conversation.getState());
  });

  test("a message that reached the page while the fetch was in flight is not rolled back by a fetch that predates it", async () => {
    const fetched = deferred<Message[]>();
    const { conversation, fake } = setup({ fetches: [fetched.promise] });
    conversation.start();

    fake.send(entryOf(1, steer("late", 5)));
    expect(held(conversation)).toEqual(["late"]);
    fetched.resolve([inThread("brief", 1)]);
    await flush();

    expect(held(conversation)).toEqual(["brief", "late"]);
  });

  test("a message in the fetch and on the stream is held once", async () => {
    const { conversation, fake } = setup({ fetches: [Promise.resolve([inThread("a1", 1)])] });
    conversation.start();
    await flush();

    fake.send(entryOf(1, inThread("a1", 1)));

    expect(held(conversation)).toEqual(["a1"]);
  });

  test("a failed fetch says why, keeps what is held, and tries again after a pause", async () => {
    const failing = Promise.reject(new Error("host down"));
    failing.catch(() => {});
    const { conversation, timers, loaded } = setup({
      fetches: [failing, Promise.resolve([inThread("a1", 1)])],
    });

    conversation.start();
    await flush();

    expect(conversation.getState().loadError).toBe("host down");
    expect(conversation.getState().phase).toBe("loading");
    expect(loaded).toEqual([]);
    expect(timers.map((timer) => timer.delayMs)).toEqual([FETCH_RETRY_MS]);

    timers[0]?.run();
    await flush();

    expect(conversation.getState().loadError).toBeNull();
    expect(held(conversation)).toEqual(["a1"]);
    expect(loaded).toHaveLength(1);
  });

  test("reload fetches again while it runs, and does nothing once stopped", async () => {
    const { conversation, fetches } = setup({
      fetches: [
        Promise.resolve([inThread("a1", 1)]),
        Promise.resolve([inThread("a1", 1), inThread("a2", 2)]),
      ],
    });

    conversation.reload();
    expect(fetches()).toBe(0);

    conversation.start();
    await flush();
    conversation.reload();
    await flush();
    expect(held(conversation)).toEqual(["a1", "a2"]);

    conversation.stop();
    conversation.reload();
    expect(fetches()).toBe(2);
  });
});

describe("following the stream", () => {
  test("takes the entries and live text of its own thread and nothing else", async () => {
    const { conversation, fake } = setup({ fetches: [Promise.resolve([])] });
    conversation.start();
    await flush();

    fake.send(entryOf(1, inThread("mine", 1)));
    fake.send(entryOf(2, inThread("other", 2, "thr_2")));
    fake.send(entryOf(3, userMessage("coordinator", 3)));
    fake.send(threadDelta("m1", "Working"));
    fake.send(threadDelta("o1", "elsewhere", false, "thr_2"));
    fake.send({ kind: "delta", delta: delta("c1", "coordinator") });

    expect(held(conversation)).toEqual(["mine"]);
    expect(conversation.getState().live).toEqual({ m1: "Working" });
  });

  test("shows a reply as it is written, then the finished message takes its place", async () => {
    const { conversation, fake } = setup({ fetches: [Promise.resolve([steer("s1", 1)])] });
    conversation.start();
    await flush();

    fake.send(threadDelta("a1", "On it. ", true));
    fake.send(threadDelta("a1", "Two files."));
    expect(conversation.getState().live).toEqual({ a1: "On it. Two files." });

    fake.send(entryOf(1, inThread("a1", 2)));

    expect(conversation.getState().live).toEqual({});
    expect(held(conversation)).toEqual(["s1", "a1"]);
  });

  test("a replay after a reconnect that repeats entries leaves no duplicates and misses none", async () => {
    const { conversation, fake } = setup({ fetches: [Promise.resolve([])] });
    conversation.start();
    await flush();
    fake.send(entryOf(1, inThread("a1", 1)));
    fake.send(entryOf(2, steer("s1", 2)));

    fake.send(entryOf(1, inThread("a1", 1)));
    fake.send(entryOf(2, steer("s1", 2)));
    fake.send(entryOf(3, inThread("a2", 3)));

    expect(held(conversation)).toEqual(["a1", "s1", "a2"]);
  });

  test("live text is dropped when the connection drops, and rebuilt from the baseline the reconnect sends", async () => {
    const { conversation, fake } = setup({ fetches: [Promise.resolve([])] });
    conversation.start();
    await flush();
    fake.send(threadDelta("a1", "Working"));

    fake.setConnection("reconnecting");
    expect(conversation.getState().live).toEqual({});

    fake.setConnection("live");
    fake.send(threadDelta("a1", "Working on it", true));
    fake.send(threadDelta("a1", "."));
    expect(conversation.getState().live).toEqual({ a1: "Working on it." });
  });

  test("a resync fetches again and the fetch replaces what was held", async () => {
    const { conversation, fake } = setup({
      fetches: [
        Promise.resolve([inThread("a1", 1), inThread("ghost", 2)]),
        Promise.resolve([inThread("a1", 1)]),
      ],
    });
    conversation.start();
    await flush();
    expect(held(conversation)).toEqual(["a1", "ghost"]);

    fake.resync();
    await flush();

    expect(held(conversation)).toEqual(["a1"]);
  });

  test("a fetch that started before a resync is dropped, so it cannot bring back what the newer one lacks", async () => {
    const first = deferred<Message[]>();
    const second = deferred<Message[]>();
    const { conversation, fake } = setup({ fetches: [first.promise, second.promise] });
    conversation.start();
    fake.resync();

    second.resolve([inThread("new", 2)]);
    await flush();
    first.resolve([inThread("stale", 1)]);
    await flush();

    expect(held(conversation)).toEqual(["new"]);
  });
});

describe("a message the host publishes again", () => {
  const proposal = (skipped: boolean, threadId: string | null = null) =>
    reply(
      "a1",
      2,
      [
        {
          type: "suggested-threads",
          suggestions: [
            {
              id: "s1",
              title: "Add retry metrics",
              prompt: "Add metrics",
              repoId: null,
              ...(skipped && { answer: { state: "skipped" as const } }),
            },
          ],
        },
      ],
      { threadId },
    );
  const updated = (id: number, message: Message) => ({
    kind: "entry" as const,
    entry: messageEntry(id, message, "message.updated"),
  });
  const skippedIn = (conversation: Conversation) => {
    const [message] = conversation.getState().messages;
    const block = message?.role === "assistant" ? message.blocks[0] : undefined;
    return block?.type === "suggested-threads" ? block.suggestions[0]?.answer?.state : undefined;
  };

  test("replaces the copy held, so an answer given on another device shows here", async () => {
    const { conversation, fake } = setup({
      scope: null,
      fetches: [Promise.resolve([proposal(false)])],
    });
    conversation.start();
    await flush();
    expect(skippedIn(conversation)).toBeUndefined();

    fake.send(updated(2, proposal(true)));

    expect(skippedIn(conversation)).toBe("skipped");
    expect(held(conversation)).toEqual(["a1"]);
  });

  test("is not rolled back by a fetch that was read before it", async () => {
    const fetched = deferred<Message[]>();
    const { conversation, fake } = setup({ scope: null, fetches: [fetched.promise] });
    conversation.start();

    fake.send(updated(2, proposal(true)));
    fetched.resolve([proposal(false)]);
    await flush();

    expect(skippedIn(conversation)).toBe("skipped");
  });

  test("a message this page does not hold is left out, and a thread's conversation ignores the coordinator's", async () => {
    const coordinator = setup({ scope: null, fetches: [Promise.resolve([userMessage("u1", 1)])] });
    coordinator.conversation.start();
    await flush();
    coordinator.fake.send(updated(2, proposal(true)));
    const inThreadScope = setup({ fetches: [Promise.resolve([inThread("brief", 1)])] });
    inThreadScope.conversation.start();
    await flush();
    inThreadScope.fake.send(updated(2, proposal(true)));

    expect(held(coordinator.conversation)).toEqual(["u1"]);
    expect(held(inThreadScope.conversation)).toEqual(["brief"]);
  });
});

describe("what this page just caused", () => {
  test("receive applies a message at once, and the stream repeating it adds nothing", async () => {
    const { conversation, fake } = setup({ fetches: [Promise.resolve([inThread("brief", 1)])] });
    conversation.start();
    await flush();

    conversation.receive(steer("sent", 2));
    expect(held(conversation)).toEqual(["brief", "sent"]);

    fake.send(entryOf(1, steer("sent", 2)));
    expect(held(conversation)).toEqual(["brief", "sent"]);
  });

  test("receive ignores a message of another conversation", async () => {
    const { conversation } = setup({ fetches: [Promise.resolve([])] });
    conversation.start();
    await flush();

    conversation.receive(steer("elsewhere", 1, "thr_2"));

    expect(held(conversation)).toEqual([]);
  });
});

describe("stopping", () => {
  test("hears nothing after stop, and a fetch still in flight is dropped", async () => {
    const fetched = deferred<Message[]>();
    const { conversation, fake, loaded } = setup({ fetches: [fetched.promise] });
    conversation.start();

    conversation.stop();
    fetched.resolve([inThread("a1", 1)]);
    await flush();
    fake.send(entryOf(1, inThread("a2", 2)));

    expect(fake.listenerCount()).toBe(0);
    expect(conversation.getState().phase).toBe("loading");
    expect(held(conversation)).toEqual([]);
    expect(loaded).toEqual([]);
  });

  test("a retry waiting after a failed fetch is cancelled", async () => {
    const failing = Promise.reject(new Error("host down"));
    failing.catch(() => {});
    const { conversation, timers } = setup({ fetches: [failing] });
    conversation.start();
    await flush();

    conversation.stop();

    expect(timers[0]?.cancelled).toBe(true);
  });

  test("start after stop follows the stream again and fetches again", async () => {
    const { conversation, fake } = setup({
      fetches: [
        Promise.resolve([inThread("a1", 1)]),
        Promise.resolve([inThread("a1", 1), inThread("a2", 2)]),
      ],
    });
    conversation.start();
    await flush();
    conversation.stop();

    conversation.start();
    await flush();

    expect(fake.listenerCount()).toBe(2);
    expect(held(conversation)).toEqual(["a1", "a2"]);
  });
});

describe("the coordinator's conversation", () => {
  test("is the same conversation with no thread: it holds the messages that belong to no thread", async () => {
    const { conversation, fake } = setup({
      scope: null,
      fetches: [Promise.resolve([userMessage("u1", 1), inThread("t1", 2)])],
    });
    conversation.start();
    await flush();
    fake.send(entryOf(1, inThread("t2", 3)));
    fake.send(entryOf(2, reply("a1", 4)));

    expect(held(conversation)).toEqual(["u1", "a1"]);
  });
});
