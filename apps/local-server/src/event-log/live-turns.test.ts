import { describe, expect, test } from "bun:test";
import type { EventLogEntry } from "@aop/common";
import { createLiveTurns, mergeDelta } from "./live-turns.ts";
import { liveText } from "./test-utils.ts";

const settled = (entry: Omit<EventLogEntry, "id">): EventLogEntry =>
  ({ id: 1, ...entry }) as EventLogEntry;

const reply = (id: string, role: "assistant" | "user" = "assistant") =>
  settled({
    projectId: "p1",
    type: "message.created",
    payload: {
      message:
        role === "assistant"
          ? {
              id,
              projectId: "p1",
              threadId: null,
              createdAt: "2026-09-30T09:00:00.000Z",
              role,
              blocks: [{ type: "text", text: "Done." }],
            }
          : {
              id,
              projectId: "p1",
              threadId: null,
              createdAt: "2026-09-30T09:00:00.000Z",
              role,
              text: "Hi",
            },
    },
  });

describe("live turns", () => {
  test("accumulates appended text and hands it back as a replacing baseline", () => {
    const turns = createLiveTurns();

    turns.apply(liveText({ text: "Hel" }));
    turns.apply(liveText({ text: "lo" }));

    expect(turns.list("p1")).toEqual([liveText({ text: "Hello", replace: true })]);
  });

  test("a replacement overwrites, and an empty one forgets the turn", () => {
    const turns = createLiveTurns();
    turns.apply(liveText({ text: "Hello" }));

    turns.apply(liveText({ text: "Hi there", replace: true }));
    expect(turns.list("p1")).toEqual([liveText({ text: "Hi there", replace: true })]);

    turns.apply(liveText({ text: "", replace: true }));
    expect(turns.list("p1")).toEqual([]);
  });

  test("keeps turns apart by message and by project", () => {
    const turns = createLiveTurns();

    turns.apply(liveText({ messageId: "m1", text: "one" }));
    turns.apply(liveText({ messageId: "m2", threadId: "t1", text: "two" }));
    turns.apply(liveText({ projectId: "p2", messageId: "m3", text: "three" }));

    expect(turns.list("p1").map((turn) => turn.text)).toEqual(["one", "two"]);
    expect(turns.list("p2").map((turn) => turn.text)).toEqual(["three"]);
    expect(turns.list("p3")).toEqual([]);
  });

  describe("settle", () => {
    const withThreeTurns = () => {
      const turns = createLiveTurns();
      turns.apply(liveText({ messageId: "m1", threadId: null, text: "coordinator" }));
      turns.apply(liveText({ messageId: "m2", threadId: "t1", text: "thread one" }));
      turns.apply(liveText({ messageId: "m3", threadId: "t2", text: "thread two" }));
      turns.apply(liveText({ projectId: "p2", messageId: "m4", text: "other project" }));
      return turns;
    };

    test("an assistant reply ends the turn it is the message of, and only that one", () => {
      const turns = withThreeTurns();

      turns.settle(reply("m2"));

      expect(turns.list("p1").map((turn) => turn.messageId)).toEqual(["m1", "m3"]);
    });

    test("a user message ends nothing", () => {
      const turns = withThreeTurns();

      turns.settle(reply("m2", "user"));

      expect(turns.list("p1")).toHaveLength(3);
    });

    test("removing a thread ends its turns", () => {
      const turns = withThreeTurns();

      turns.settle(
        settled({ projectId: "p1", type: "thread.removed", payload: { threadId: "t1" } }),
      );

      expect(turns.list("p1").map((turn) => turn.messageId)).toEqual(["m1", "m3"]);
    });

    test("removing a project ends all of its turns and no other project's", () => {
      const turns = withThreeTurns();

      turns.settle(settled({ projectId: "p1", type: "project.removed", payload: {} }));

      expect(turns.list("p1")).toEqual([]);
      expect(turns.list("p2")).toHaveLength(1);
    });
  });
});

describe("mergeDelta", () => {
  test("with nothing waiting, is the delta itself", () => {
    expect(mergeDelta(undefined, liveText({ text: "Hel" }))).toEqual(liveText({ text: "Hel" }));
  });

  test("extends the waiting text with an append", () => {
    const merged = mergeDelta(liveText({ text: "Hel" }), liveText({ text: "lo" }));

    expect(merged).toEqual(liveText({ text: "Hello", replace: false }));
  });

  test("keeps a waiting baseline a baseline when text is appended to it", () => {
    const merged = mergeDelta(liveText({ text: "Hel", replace: true }), liveText({ text: "lo" }));

    expect(merged).toEqual(liveText({ text: "Hello", replace: true }));
  });

  test("a replacement supersedes whatever was waiting", () => {
    const merged = mergeDelta(
      liveText({ text: "Hello" }),
      liveText({ text: "Hi there", replace: true }),
    );

    expect(merged).toEqual(liveText({ text: "Hi there", replace: true }));
  });
});
