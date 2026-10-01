import { describe, expect, test } from "bun:test";
import type { Message } from "@aop/common";
import {
  applyDelta,
  applyEarlier,
  applyLiveSnapshot,
  applyMessage,
  applyMessageUpdate,
  applySnapshot,
  createChatState,
  initialChatState,
  isWorking,
  setEarlierError,
  setLoadError,
  startLoadingEarlier,
  stopLoadingEarlier,
  unansweredMessages,
} from "./chat-state";
import { appended, delta, ids, liveTexts, page, reply, report, userMessage } from "./test-utils";

const ready = (...messages: Message[]) => applySnapshot(initialChatState, page(messages));

describe("applySnapshot", () => {
  test("holds the fetched messages in the host's order and marks the chat ready", () => {
    const state = ready(userMessage("u1", 1), reply("a1", 2));

    expect(state.phase).toBe("ready");
    expect(ids(state.messages)).toEqual(["u1", "a1"]);
  });

  test("replaces what was held, so a message the host no longer has disappears", () => {
    const before = ready(userMessage("u1", 1), reply("ghost", 2));

    expect(ids(applySnapshot(before, page([userMessage("u1", 1)])).messages)).toEqual(["u1"]);
  });

  test("clears a failed fetch and drops the live text of a message the snapshot holds", () => {
    let state = setLoadError(initialChatState, "host down");
    state = applyDelta(state, delta("a1", "Working on"));

    const next = applySnapshot(state, page([userMessage("u1", 1), reply("a1", 2)]));

    expect(next.loadError).toBeNull();
    expect(next.live).toEqual({});
  });

  test("keeps the live text of a reply the snapshot does not hold yet", () => {
    const state = applyDelta(initialChatState, delta("a1", "Working"));

    expect(liveTexts(applySnapshot(state, page([userMessage("u1", 1)])))).toEqual({
      a1: "Working",
    });
  });

  test("leaves out messages of a thread", () => {
    const state = ready(userMessage("u1", 1), reply("t1", 2, undefined, { threadId: "thr_1" }));

    expect(ids(state.messages)).toEqual(["u1"]);
  });
});

describe("applyMessage", () => {
  test("applying the same message twice leaves the same chat", () => {
    const once = applyMessage(ready(), userMessage("u1", 1));
    const twice = applyMessage(once, userMessage("u1", 1));

    expect(ids(twice.messages)).toEqual(["u1"]);
  });

  test("a message that is already held is replaced in place", () => {
    const state = ready(userMessage("u1", 1), reply("a1", 2), userMessage("u2", 3));

    const next = applyMessage(state, reply("a1", 2, [{ type: "text", text: "edited" }]));

    expect(ids(next.messages)).toEqual(["u1", "a1", "u2"]);
    expect(next.messages[1]).toMatchObject({ blocks: [{ type: "text", text: "edited" }] });
  });

  test("a reply is placed after the message it answers, before one sent while the coordinator worked", () => {
    let state = ready(userMessage("u1", 1));
    state = applyMessage(state, userMessage("u2", 2));
    state = applyMessage(state, report("r1", 3));

    state = applyMessage(state, reply("a1", 4));
    expect(ids(state.messages)).toEqual(["u1", "a1", "u2", "r1"]);

    state = applyMessage(state, reply("a2", 5));
    expect(ids(state.messages)).toEqual(["u1", "a1", "u2", "a2", "r1"]);

    state = applyMessage(state, reply("a3", 6));
    expect(ids(state.messages)).toEqual(["u1", "a1", "u2", "a2", "r1", "a3"]);
  });

  test("a reply to several reports that arrived together sits after the newest of them and leaves nothing unanswered", () => {
    let state = ready(userMessage("u1", 1), reply("a1", 2));
    for (const [id, seconds] of [
      ["r1", 3],
      ["r2", 4],
      ["r3", 5],
    ] as const) {
      state = applyMessage(state, report(id, seconds));
    }

    state = applyMessage(state, reply("a2", 6, undefined, { inReplyTo: "r3" }));
    expect(ids(state.messages)).toEqual(["u1", "a1", "r1", "r2", "r3", "a2"]);
    expect(isWorking(state)).toBe(false);

    // A report that came in while the batch was being answered is still waiting.
    state = applyMessage(state, report("r4", 7));
    expect(ids(state.messages)).toEqual(["u1", "a1", "r1", "r2", "r3", "a2", "r4"]);
    expect(isWorking(state)).toBe(true);
  });

  test("a reply whose message is not held falls back to the oldest one nothing answers", () => {
    const state = applyMessage(
      ready(userMessage("u1", 1)),
      reply("a1", 2, undefined, { inReplyTo: "gone" }),
    );

    expect(ids(state.messages)).toEqual(["u1", "a1"]);
  });

  test("arriving one by one gives the order a fetch of the same messages gives", () => {
    const stored = [
      userMessage("u1", 1),
      reply("a1", 4),
      userMessage("u2", 2),
      reply("a2", 5),
      report("r1", 3),
      reply("a3", 6),
    ];
    const inArrivalOrder = [...stored].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const live = inArrivalOrder.reduce(applyMessage, ready());

    expect(ids(live.messages)).toEqual(ids(stored));
  });

  test("a reply nobody asked for goes to the end", () => {
    const state = applyMessage(ready(userMessage("u1", 1), reply("a1", 2)), reply("a2", 3));

    expect(ids(state.messages)).toEqual(["u1", "a1", "a2"]);
  });

  test("a message sent by this page that arrives behind one stored after it goes before it", () => {
    const state = applyMessage(ready(userMessage("u0", 0), report("r1", 5)), userMessage("u1", 3));

    expect(ids(state.messages)).toEqual(["u0", "u1", "r1"]);
  });

  test("the finished message replaces its live text", () => {
    const state = applyMessage(
      applyDelta(ready(userMessage("u1", 1)), delta("a1", "Working on it")),
      reply("a1", 2),
    );

    expect(state.live).toEqual({});
    expect(ids(state.messages)).toEqual(["u1", "a1"]);
  });

  test("ignores a message of a thread", () => {
    const state = ready(userMessage("u1", 1));

    expect(applyMessage(state, reply("t1", 2, undefined, { threadId: "thr_1" }))).toBe(state);
  });
});

describe("applyMessageUpdate", () => {
  const proposal = (answered: boolean) =>
    reply("a1", 2, [
      {
        type: "suggested-threads",
        suggestions: [
          {
            id: "s1",
            title: "Add retry metrics",
            prompt: "Add metrics",
            repoId: null,
            ...(answered && { answer: { state: "skipped" as const } }),
          },
        ],
      },
    ]);

  test("replaces the copy that is held, in place", () => {
    const before = ready(userMessage("u1", 1), proposal(false), userMessage("u2", 3));

    const after = applyMessageUpdate(before, proposal(true));

    expect(ids(after.messages)).toEqual(["u1", "a1", "u2"]);
    expect(after.messages[1]).toEqual(proposal(true));
  });

  test("applying the same update twice leaves the same chat", () => {
    const once = applyMessageUpdate(ready(proposal(false)), proposal(true));

    expect(applyMessageUpdate(once, proposal(true)).messages).toEqual(once.messages);
  });

  test("does not add a message the page does not hold: it would land out of order", () => {
    const before = ready(userMessage("u1", 1), reply("a2", 5));

    expect(applyMessageUpdate(before, proposal(true))).toBe(before);
  });

  test("ignores an update to a message of a thread", () => {
    const before = ready(proposal(false));

    expect(applyMessageUpdate(before, { ...proposal(true), threadId: "thr_1" })).toBe(before);
  });
});

describe("applyDelta", () => {
  test("appended slices build the live text of one reply", () => {
    let state = applyDelta(initialChatState, delta("a1", "On it. "));
    state = applyDelta(state, appended("a1", "Three threads."));

    expect(liveTexts(state)).toEqual({ a1: "On it. Three threads." });
  });

  test("a replace frame is the baseline: it sets the text instead of extending it", () => {
    let state = applyDelta(initialChatState, delta("a1", "stale"));
    state = applyDelta(state, delta("a1", "On it. Three", { replace: true }));
    state = applyDelta(state, appended("a1", " threads."));

    expect(liveTexts(state)).toEqual({ a1: "On it. Three threads." });
  });

  test("reasoning, tool calls and their results arrive as parts of the reply, in order", () => {
    const tool = { type: "tool", id: "t1", name: "Bash", detail: null, status: "running" } as const;
    let state = applyDelta(initialChatState, delta("a1", "Looking. ", { inReplyTo: "u1" }));
    state = applyDelta(state, {
      ...appended("a1", "Running it."),
      ops: [
        { op: "append", index: 0, text: "Running it." },
        { op: "start", index: 1, part: tool },
        { op: "tool", index: 1, status: "done", detail: "bun test" },
        { op: "start", index: 2, part: { type: "thinking", text: "Green." } },
      ],
    });

    expect(state.live.a1).toEqual({
      inReplyTo: "u1",
      parts: [
        { type: "text", text: "Looking. Running it." },
        { ...tool, status: "done", detail: "bun test" },
        { type: "thinking", text: "Green." },
      ],
    });
  });

  test("an empty replace drops the live text of a turn that ended without a message", () => {
    const state = applyDelta(
      applyDelta(initialChatState, delta("a1", "Working")),
      delta("a1", "", { replace: true }),
    );

    expect(state.live).toEqual({});
  });

  test("a delta that arrives after its message is not shown", () => {
    const state = applyDelta(
      applyMessage(ready(userMessage("u1", 1)), reply("a1", 2)),
      delta("a1", "late"),
    );

    expect(state.live).toEqual({});
  });

  test("live text of a thread is not the coordinator's", () => {
    const state = applyDelta(initialChatState, delta("a1", "x", { threadId: "thr_1" }));

    expect(state.live).toEqual({});
  });
});

describe("applyLiveSnapshot", () => {
  const snapshot = (...turns: ReturnType<typeof delta>[]) => ({ turns });

  test("keeps what was shown of a turn still running and goes on from its baseline", () => {
    let state = applyDelta(ready(userMessage("u1", 1)), delta("a1", "Working on"));
    state = applyLiveSnapshot(state, snapshot(delta("a1", "Working on it", { replace: true })));

    expect(liveTexts(state)).toEqual({ a1: "Working on it" });
    expect(ids(state.messages)).toEqual(["u1"]);
  });

  test("drops a turn that ended while the page could not hear, and leaves the messages", () => {
    let state = applyDelta(ready(userMessage("u1", 1)), delta("a1", "Working"));
    state = applyDelta(state, delta("t1", "Elsewhere", { threadId: "thr_1" }));

    const next = applyLiveSnapshot(state, snapshot());

    expect(next.live).toEqual({});
    expect(ids(next.messages)).toEqual(["u1"]);
  });

  test("takes only its own conversation's turns, and a turn that started meanwhile", () => {
    const state = applyLiveSnapshot(
      ready(userMessage("u1", 1)),
      snapshot(delta("a2", "Fresh", { inReplyTo: "u1" }), delta("t1", "x", { threadId: "thr_1" })),
    );

    expect(liveTexts(state)).toEqual({ a2: "Fresh" });
    expect(state.live.a2?.inReplyTo).toBe("u1");
  });
});

describe("unansweredMessages", () => {
  test("are the person's messages and thread reports after the last reply", () => {
    const messages = [userMessage("u1", 1), reply("a1", 2), userMessage("u2", 3), report("r1", 4)];

    expect(ids(unansweredMessages(messages))).toEqual(["u2", "r1"]);
  });

  test("are all of them before the first reply, and none once every one is answered", () => {
    expect(ids(unansweredMessages([userMessage("u1", 1)]))).toEqual(["u1"]);
    expect(unansweredMessages([userMessage("u1", 1), reply("a1", 2)])).toEqual([]);
  });

  test("leave out a message sent into a running turn: that turn's reply answers it", () => {
    const messages = [
      userMessage("u1", 1),
      reply("a1", 3, undefined, { inReplyTo: "u1" }),
      userMessage("u2", 2, { steers: "a1" }),
    ];

    expect(unansweredMessages(messages)).toEqual([]);
    // A relayed message sent into a thread's turn is no reply either.
    const relayed = reply("c1", 4, undefined, { steers: "a2" });
    expect(ids(unansweredMessages([userMessage("u3", 3), relayed]))).toEqual(["u3"]);
  });
});

describe("a thread's conversation", () => {
  const inThread = (id: string, seconds: number, threadId = "thr_1") =>
    reply(id, seconds, undefined, { threadId });
  const userIn = (id: string, seconds: number, threadId = "thr_1") =>
    userMessage(id, seconds, { threadId });
  const threadReady = (...messages: Message[]) =>
    applySnapshot(createChatState("thr_1"), page(messages));

  test("starts loading, knows which thread it holds, and the coordinator's state holds none", () => {
    expect(createChatState("thr_1")).toMatchObject({
      scope: "thr_1",
      phase: "loading",
      messages: [],
    });
    expect(initialChatState.scope).toBeNull();
  });

  test("keeps only its own thread's messages on a fetch", () => {
    const state = threadReady(
      userIn("mine-u", 1),
      inThread("mine-a", 2),
      inThread("other", 3, "thr_2"),
      userMessage("coordinator", 4),
    );

    expect(state.phase).toBe("ready");
    expect(state.scope).toBe("thr_1");
    expect(ids(state.messages)).toEqual(["mine-u", "mine-a"]);
  });

  test("takes a message of its own thread and ignores the coordinator's and other threads'", () => {
    const state = threadReady();

    expect(ids(applyMessage(state, inThread("a1", 1)).messages)).toEqual(["a1"]);
    expect(applyMessage(state, userMessage("coordinator", 1))).toBe(state);
    expect(applyMessage(state, inThread("other", 1, "thr_2"))).toBe(state);
  });

  test("puts an agent's reply after the steer it answers, as the host stores them", () => {
    let state = threadReady(inThread("brief", 1));
    state = applyMessage(state, userIn("steer", 3));
    state = applyMessage(state, inThread("answer", 4));

    expect(ids(state.messages)).toEqual(["brief", "steer", "answer"]);
  });

  test("takes its own live text and not the coordinator's or another thread's", () => {
    let state = threadReady();
    state = applyDelta(state, delta("a1", "Working", { threadId: "thr_1" }));
    state = applyDelta(state, appended("a1", " on it", { threadId: "thr_1" }));
    state = applyDelta(state, delta("c1", "coordinator"));
    state = applyDelta(state, delta("t2", "elsewhere", { threadId: "thr_2" }));

    expect(liveTexts(state)).toEqual({ a1: "Working on it" });
  });

  test("its finished reply replaces its live text, as the coordinator's does", () => {
    const state = applyMessage(
      applyDelta(threadReady(), delta("a1", "Working", { threadId: "thr_1" })),
      inThread("a1", 2),
    );

    expect(state.live).toEqual({});
    expect(ids(state.messages)).toEqual(["a1"]);
  });

  test("a fetch keeps the live text of a reply it does not hold yet and drops one it does", () => {
    let state = applyDelta(createChatState("thr_1"), delta("a1", "One", { threadId: "thr_1" }));
    state = applyDelta(state, delta("a2", "Two", { threadId: "thr_1" }));

    const next = applySnapshot(state, page([inThread("a1", 1)]));

    expect(liveTexts(next)).toEqual({ a2: "Two" });
    expect(next.scope).toBe("thr_1");
  });
});

describe("older pages of the conversation", () => {
  const latest = (hasMore: boolean) =>
    applySnapshot(
      initialChatState,
      page([userMessage("u3", 3), reply("a3", 4), userMessage("u4", 5)], hasMore),
    );

  test("a fetch of the newest page says whether the host holds older messages", () => {
    expect(latest(true).hasEarlier).toBe(true);
    expect(latest(false).hasEarlier).toBe(false);
  });

  test("an older page goes before the messages held, once each, and the host says whether more remain", () => {
    const next = applyEarlier(
      latest(true),
      page([userMessage("u1", 1), reply("a1", 2), userMessage("u3", 3)], true),
    );

    expect(ids(next.messages)).toEqual(["u1", "a1", "u3", "a3", "u4"]);
    expect(next.hasEarlier).toBe(true);
    expect(applyEarlier(next, page([userMessage("u0", 0)], false)).hasEarlier).toBe(false);
  });

  test("an older page holds only this conversation's messages", () => {
    const thread = applySnapshot(
      createChatState("thr_1"),
      page([reply("a3", 3, undefined, { threadId: "thr_1" })], true),
    );

    const next = applyEarlier(
      thread,
      page([reply("a1", 1, undefined, { threadId: "thr_1" }), userMessage("elsewhere", 2)]),
    );

    expect(ids(next.messages)).toEqual(["a1", "a3"]);
  });

  test("the newest page fetched again keeps the older messages that join it, and their say on what remains", () => {
    const loaded = applyEarlier(latest(true), page([userMessage("u1", 1), reply("a1", 2)], false));

    const next = applySnapshot(
      loaded,
      page([userMessage("u3", 3), reply("a3", 4), userMessage("u4", 5), reply("a4", 6)], true),
    );

    expect(ids(next.messages)).toEqual(["u1", "a1", "u3", "a3", "u4", "a4"]);
    expect(next.hasEarlier).toBe(false);
  });

  test("a newest page that does not join what is held replaces it, and its say on what remains stands", () => {
    const loaded = applyEarlier(latest(true), page([userMessage("u1", 1)], false));

    const next = applySnapshot(loaded, page([reply("a9", 90), userMessage("u10", 91)], true));

    expect(ids(next.messages)).toEqual(["a9", "u10"]);
    expect(next.hasEarlier).toBe(true);
  });

  test("tracks the fetch: loading, then done or failed", () => {
    const loading = startLoadingEarlier(setEarlierError(latest(true), "old failure"));
    expect(loading).toMatchObject({ loadingEarlier: true, earlierError: null });

    expect(setEarlierError(loading, "Host unreachable")).toMatchObject({
      loadingEarlier: false,
      earlierError: "Host unreachable",
    });
    expect(stopLoadingEarlier(loading).loadingEarlier).toBe(false);
    expect(applyEarlier(loading, page([], false)).loadingEarlier).toBe(false);
  });
});
