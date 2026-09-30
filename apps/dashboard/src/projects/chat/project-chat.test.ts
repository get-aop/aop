import { describe, expect, test } from "bun:test";
import type { Message } from "@aop/common";
import type { ChatApi } from "./chat-api";
import { FETCH_RETRY_MS } from "./conversation";
import { createProjectChat } from "./project-chat";
import {
  at,
  createFakeEvents,
  deferred,
  ids,
  memorySeenStore,
  page,
  pageFrom,
  reply,
  report,
  userMessage,
} from "./test-utils";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A chat over a fake host: `fetches` are the answers the next fetches will give, in order. */
const setup = (options: { seen?: Record<string, string>; fetches?: Promise<Message[]>[] } = {}) => {
  const fake = createFakeEvents();
  const seen = memorySeenStore(options.seen);
  const pending = [...(options.fetches ?? [])];
  const sent: string[] = [];
  const api: Pick<ChatApi, "listMessages" | "sendMessage"> = {
    listMessages: () => pageFrom(pending),
    sendMessage: async (_projectId, text) => {
      sent.push(text);
      return userMessage("sent", 9, { text });
    },
  };
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  const chat = createProjectChat({
    projectId: "prj_1",
    api,
    events: fake.events,
    seen,
    schedule: (run, delayMs) => {
      const timer = { run, delayMs, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  return { chat, fake, seen, sent, api, timers };
};

const held = (chat: ReturnType<typeof setup>["chat"]) => ids(chat.getState().messages);

describe("loading", () => {
  test("listens to the stream before it fetches, and holds the fetched messages once they arrive", async () => {
    const fetched = deferred<Message[]>();
    const { chat, fake } = setup({ fetches: [fetched.promise] });

    chat.start();
    expect(fake.listenerCount()).toBe(2);
    expect(chat.getState().phase).toBe("loading");

    fetched.resolve([userMessage("u1", 1), reply("a1", 2)]);
    await flush();

    expect(chat.getState().phase).toBe("ready");
    expect(held(chat)).toEqual(["u1", "a1"]);
  });

  test("a message the stream delivers while the fetch is in flight is not rolled back by a fetch that predates it", async () => {
    const fetched = deferred<Message[]>();
    const { chat, fake } = setup({ fetches: [fetched.promise] });
    chat.start();

    fake.entry(3, reply("a2", 4));
    fetched.resolve([userMessage("u1", 1), reply("a1", 2), userMessage("u2", 3)]);
    await flush();

    expect(held(chat)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  test("a message in the fetch and on the stream is held once", async () => {
    const fetched = deferred<Message[]>();
    const { chat, fake } = setup({ fetches: [fetched.promise] });
    chat.start();

    fake.entry(1, userMessage("u1", 1));
    fetched.resolve([userMessage("u1", 1)]);
    await flush();
    fake.entry(1, userMessage("u1", 1));

    expect(held(chat)).toEqual(["u1"]);
  });

  test("a failed fetch says why, keeps what is held, and tries again", async () => {
    const { chat, timers, api } = setup();
    let attempts = 0;
    api.listMessages = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Host unreachable");
      return page([userMessage("u1", 1)]);
    };
    chat.start();
    await flush();

    expect(chat.getState()).toMatchObject({ phase: "loading", loadError: "Host unreachable" });
    expect(timers.at(-1)?.delayMs).toBe(FETCH_RETRY_MS);

    timers.at(-1)?.run();
    await flush();

    expect(chat.getState()).toMatchObject({ phase: "ready", loadError: null });
    expect(held(chat)).toEqual(["u1"]);
  });

  test("reload fetches again", async () => {
    const { chat } = setup({
      fetches: [
        Promise.resolve([userMessage("u1", 1)]),
        Promise.resolve([userMessage("u1", 1), reply("a1", 2)]),
      ],
    });
    chat.start();
    await flush();

    chat.reload();
    await flush();

    expect(held(chat)).toEqual(["u1", "a1"]);
  });
});

describe("resync", () => {
  test("refetches, and the fetch replaces what was held", async () => {
    const { chat, fake } = setup({
      fetches: [
        Promise.resolve([userMessage("u1", 1), reply("ghost", 2)]),
        Promise.resolve([userMessage("u1", 1), reply("a1", 3)]),
      ],
    });
    chat.start();
    await flush();

    fake.resync();
    await flush();

    expect(held(chat)).toEqual(["u1", "a1"]);
  });

  test("a fetch that started before a resync is dropped, so it cannot bring back what the newer one lacks", async () => {
    const first = deferred<Message[]>();
    const second = deferred<Message[]>();
    const { chat, fake } = setup({ fetches: [first.promise, second.promise] });
    chat.start();

    fake.resync();
    second.resolve([userMessage("u1", 1), reply("a1", 2)]);
    await flush();
    first.resolve([userMessage("stale", 0)]);
    await flush();

    expect(held(chat)).toEqual(["u1", "a1"]);
  });
});

describe("the stream", () => {
  test("a replay after a reconnect that repeats entries leaves no duplicates and misses none", async () => {
    const { chat, fake } = setup({ fetches: [Promise.resolve([userMessage("u1", 1)])] });
    chat.start();
    await flush();

    fake.entry(2, reply("a1", 2));
    fake.setConnection("reconnecting");
    fake.setConnection("live");
    fake.entry(2, reply("a1", 2));
    fake.entry(3, userMessage("u2", 3));
    fake.entry(4, reply("a2", 4));

    expect(held(chat)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  test("live text shows as it arrives and gives way to the finished message", async () => {
    const { chat, fake } = setup({ fetches: [Promise.resolve([userMessage("u1", 1)])] });
    chat.start();
    await flush();

    fake.delta("a1", "On it. ");
    fake.delta("a1", "Two threads.");
    expect(chat.getState().live).toEqual({ a1: "On it. Two threads." });

    fake.entry(2, reply("a1", 2));
    expect(chat.getState().live).toEqual({});
    expect(held(chat)).toEqual(["u1", "a1"]);
  });

  test("live text is dropped when the connection drops and rebuilt from the baseline the reconnect sends", async () => {
    const { chat, fake } = setup({ fetches: [Promise.resolve([userMessage("u1", 1)])] });
    chat.start();
    await flush();
    fake.delta("a1", "On it. Two");

    fake.setConnection("reconnecting");
    expect(chat.getState().live).toEqual({});

    fake.setConnection("live");
    fake.delta("a1", "On it. Two threads", true);
    fake.delta("a1", ".");
    expect(chat.getState().live).toEqual({ a1: "On it. Two threads." });
  });

  test("ignores messages and live text of a thread", async () => {
    const { chat, fake } = setup({ fetches: [Promise.resolve([])] });
    chat.start();
    await flush();

    fake.entry(1, reply("t1", 1, undefined, { threadId: "thr_1" }));

    expect(held(chat)).toEqual([]);
  });

  test("after stop nothing is heard and a fetch still in flight is dropped", async () => {
    const fetched = deferred<Message[]>();
    const { chat, fake } = setup({ fetches: [fetched.promise] });
    chat.start();

    chat.stop();
    fetched.resolve([userMessage("u1", 1)]);
    await flush();
    fake.entry(1, userMessage("u2", 2));

    expect(fake.listenerCount()).toBe(0);
    expect(chat.getState().phase).toBe("loading");
    expect(held(chat)).toEqual([]);
  });

  test("start after stop follows the stream again and refetches", async () => {
    const { chat, fake } = setup({
      fetches: [
        Promise.resolve([userMessage("u1", 1)]),
        Promise.resolve([userMessage("u1", 1), reply("a1", 2)]),
      ],
    });
    chat.start();
    await flush();
    chat.stop();

    chat.start();
    await flush();

    expect(fake.listenerCount()).toBe(2);
    expect(held(chat)).toEqual(["u1", "a1"]);
  });
});

describe("sending", () => {
  test("the message the host returns appears at once, and the stream repeating it adds nothing", async () => {
    const { chat, fake, sent } = setup({ fetches: [Promise.resolve([])] });
    chat.start();
    await flush();

    expect(await chat.send("plan the release")).toEqual({ ok: true });
    fake.entry(1, userMessage("sent", 9, { text: "plan the release" }));

    expect(sent).toEqual(["plan the release"]);
    expect(held(chat)).toEqual(["sent"]);
  });

  test("a message the stream delivered before the send returned is not added a second time", async () => {
    const { chat, fake } = setup({ fetches: [Promise.resolve([])] });
    chat.start();
    await flush();

    fake.entry(1, userMessage("sent", 9));
    await chat.send("hello");

    expect(held(chat)).toEqual(["sent"]);
  });

  test("a refused send answers why and changes nothing", async () => {
    const { chat, api } = setup({ fetches: [Promise.resolve([userMessage("u1", 1)])] });
    api.sendMessage = async () => {
      throw new Error("The project is paused");
    };
    chat.start();
    await flush();

    expect(await chat.send("hello")).toEqual({ ok: false, error: "The project is paused" });
    expect(held(chat)).toEqual(["u1"]);
  });
});

describe("what this device has seen", () => {
  test("the first time a project is loaded, what is there counts as seen; later replies do not", async () => {
    const { chat, fake, seen } = setup({
      fetches: [Promise.resolve([userMessage("u1", 1), reply("a1", 2)])],
    });
    chat.start();
    await flush();

    expect(seen.saved.prj_1).toBe(at(2));

    fake.entry(3, reply("a2", 5, undefined));
    fake.entry(4, report("r1", 6));
    fake.entry(5, reply("a3", 7));
    expect(seen.saved.prj_1).toBe(at(2));
    expect(chat.getState().seenAt).toBe(at(2));
  });

  test("marking the chat seen is kept for the next visit", async () => {
    const { chat, fake, seen } = setup({ fetches: [Promise.resolve([userMessage("u1", 1)])] });
    chat.start();
    await flush();
    fake.entry(2, reply("a1", 3));

    chat.markSeen();

    expect(chat.getState().seenAt).toBe(at(3));
    expect(seen.saved.prj_1).toBe(at(3));
  });
});
