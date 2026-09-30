import { describe, expect, test } from "bun:test";
import { buildRows, type ChatRow, type RowsInput } from "./chat-rows";
import { at, reply, report, userMessage } from "./test-utils";

const NOON = new Date("2026-09-30T12:00:00.000Z");

const rowsOf = (input: Partial<RowsInput>) =>
  buildRows({
    messages: [],
    live: {},
    working: false,
    firstNewId: null,
    window: 100,
    now: NOON,
    ...input,
  });

const shape = (rows: readonly ChatRow[]): string[] =>
  rows.map((row) => (row.kind === "message" ? row.message.id : row.kind));

describe("buildRows", () => {
  test("lists the messages in order under the day they were written", () => {
    const { rows } = rowsOf({ messages: [userMessage("u1", 1), reply("a1", 2)] });

    expect(shape(rows)).toEqual(["day", "u1", "a1"]);
    expect(rows[0]).toMatchObject({ kind: "day", label: "Today" });
  });

  test("marks a new day only where the day changes", () => {
    const yesterday = userMessage("old", 0, { createdAt: "2026-09-29T09:00:00.000Z" });

    const { rows } = rowsOf({ messages: [yesterday, userMessage("u1", 1), reply("a1", 2)] });

    expect(shape(rows)).toEqual(["day", "old", "day", "u1", "a1"]);
    expect(
      rows.filter((row) => row.kind === "day").map((row) => (row as { label: string }).label),
    ).toEqual(["Yesterday", "Today"]);
  });

  test("puts the New line before the first message the person had not seen", () => {
    const { rows } = rowsOf({
      messages: [userMessage("u1", 1), reply("a1", 2), reply("a2", 3)],
      firstNewId: "a1",
    });

    expect(shape(rows)).toEqual(["day", "u1", "new", "a1", "a2"]);
  });

  test("shows the latest messages and says how many are hidden", () => {
    const messages = [userMessage("u1", 1), reply("a1", 2), userMessage("u2", 3), reply("a2", 4)];

    const { rows, hidden } = rowsOf({ messages, window: 2 });

    expect(hidden).toBe(2);
    expect(shape(rows)).toEqual(["day", "u2", "a2"]);
  });

  test("while the coordinator works, its live text follows the message it is answering, before messages that wait behind it", () => {
    const { rows } = rowsOf({
      messages: [userMessage("u1", 1), reply("a1", 2), userMessage("u2", 3), report("r1", 4)],
      live: { a2: "On it" },
      working: true,
    });

    expect(shape(rows)).toEqual(["day", "u1", "a1", "u2", "activity", "r1"]);
    expect(rows.find((row) => row.kind === "activity")).toMatchObject({
      liveText: "On it",
      since: at(3),
    });
  });

  test("shows no activity once every message is answered", () => {
    const { rows } = rowsOf({ messages: [userMessage("u1", 1), reply("a1", 2)], working: false });

    expect(shape(rows)).not.toContain("activity");
  });

  test("live text that answers nothing on screen goes last", () => {
    const { rows } = rowsOf({
      messages: [userMessage("u1", 1), reply("a1", 2)],
      live: { a2: "Early" },
      working: true,
    });

    expect(shape(rows)).toEqual(["day", "u1", "a1", "activity"]);
    expect(rows.at(-1)).toMatchObject({ kind: "activity", liveText: "Early", since: null });
  });
});
