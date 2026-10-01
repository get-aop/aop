import { describe, expect, test } from "bun:test";
import type { EventLogEntry } from "@aop/common";
import { createLiveTurns, mergeDelta } from "./live-turns.ts";
import { appended, baseline, liveDelta, started } from "./test-utils.ts";

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
  test("builds a turn's parts from what changed and hands them back as a baseline", () => {
    const turns = createLiveTurns();

    turns.apply(started("Hel", { inReplyTo: "u1" }));
    turns.apply(appended("lo"));
    turns.apply(
      liveDelta([
        {
          op: "start",
          index: 1,
          part: { type: "tool", id: "t1", name: "Bash", detail: null, status: "running" },
        },
      ]),
    );
    turns.apply(liveDelta([{ op: "tool", index: 1, status: "done", detail: "ls" }]));

    expect(turns.list("p1")).toEqual([
      liveDelta(
        [
          {
            op: "reset",
            parts: [
              { type: "text", text: "Hello" },
              { type: "tool", id: "t1", name: "Bash", detail: "ls", status: "done" },
            ],
          },
        ],
        { inReplyTo: "u1" },
      ),
    ]);
  });

  test("a baseline overwrites, and the end of a turn forgets it", () => {
    const turns = createLiveTurns();
    turns.apply(started("Hello"));

    turns.apply(baseline("Hi there"));
    expect(turns.list("p1")).toEqual([baseline("Hi there")]);

    turns.apply(liveDelta([{ op: "end" }]));
    expect(turns.list("p1")).toEqual([]);
  });

  test("keeps turns apart by message and by project", () => {
    const turns = createLiveTurns();

    turns.apply(started("one", { messageId: "m1" }));
    turns.apply(started("two", { messageId: "m2", threadId: "t1" }));
    turns.apply(started("three", { projectId: "p2", messageId: "m3" }));

    expect(turns.list("p1")).toEqual([
      baseline("one", { messageId: "m1" }),
      baseline("two", { messageId: "m2", threadId: "t1" }),
    ]);
    expect(turns.list("p2")).toEqual([baseline("three", { projectId: "p2", messageId: "m3" })]);
    expect(turns.list("p3")).toEqual([]);
  });

  describe("settle", () => {
    const withThreeTurns = () => {
      const turns = createLiveTurns();
      turns.apply(started("coordinator", { messageId: "m1", threadId: null }));
      turns.apply(started("thread one", { messageId: "m2", threadId: "t1" }));
      turns.apply(started("thread two", { messageId: "m3", threadId: "t2" }));
      turns.apply(started("other project", { projectId: "p2", messageId: "m4" }));
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
    expect(mergeDelta(undefined, started("Hel"))).toEqual(started("Hel"));
  });

  test("joins what changed, in order", () => {
    expect(mergeDelta(started("Hel"), appended("lo"))).toEqual(
      liveDelta([
        { op: "start", index: 0, part: { type: "text", text: "Hel" } },
        { op: "append", index: 0, text: "lo" },
      ]),
    );
    expect(mergeDelta(appended("Hel"), appended("lo"))).toEqual(appended("Hello"));
  });

  test("keeps a waiting baseline a baseline when more comes after it", () => {
    expect(mergeDelta(baseline("Hel"), appended("lo"))).toEqual(
      liveDelta([
        { op: "reset", parts: [{ type: "text", text: "Hel" }] },
        { op: "append", index: 0, text: "lo" },
      ]),
    );
  });

  test("a baseline or the end supersedes whatever was waiting", () => {
    expect(mergeDelta(appended("Hello"), baseline("Hi there"))).toEqual(baseline("Hi there"));
    expect(mergeDelta(baseline("Hello"), liveDelta([{ op: "end" }]))).toEqual(
      liveDelta([{ op: "end" }]),
    );
  });
});
