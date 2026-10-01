import { describe, expect, test } from "bun:test";
import { buildRows, type ChatRow, type RowsInput } from "./chat-rows";
import { at, liveTurn, reply, report, userMessage } from "./test-utils";

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
  rows.map((row) => {
    if (row.kind !== "message") return row.kind;
    return row.streaming ? `${row.message.id}…` : row.message.id;
  });

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

  test("while the coordinator works, its reply is drawn after the message it is answering, with the working line below it", () => {
    const { rows } = rowsOf({
      messages: [userMessage("u1", 1), reply("a1", 2), userMessage("u2", 3), report("r1", 4)],
      live: { a2: liveTurn("On it") },
      working: true,
    });

    expect(shape(rows)).toEqual(["day", "u1", "a1", "u2", "a2…", "working", "r1"]);
    // Under the key its message will have, so the arriving message only changes the row's data.
    expect(rows[4]).toMatchObject({
      kind: "message",
      key: "a2",
      streaming: true,
      message: { id: "a2", role: "assistant", blocks: [{ type: "text", text: "On it" }] },
    });
    expect(rows.find((row) => row.kind === "working")).toMatchObject({ since: at(3) });
  });

  test("a reply that says what it answers goes after that message, as its message will", () => {
    const { rows } = rowsOf({
      messages: [userMessage("u1", 1), report("r1", 2), report("r2", 3)],
      live: { a1: liveTurn("Both landed.", "r2") },
      working: true,
    });

    expect(shape(rows)).toEqual(["day", "u1", "r1", "r2", "a1…", "working"]);
    expect(rows.at(-1)).toMatchObject({ kind: "working", since: at(3) });
  });

  test("before any text, the working line follows the message being answered", () => {
    const { rows } = rowsOf({
      messages: [userMessage("u1", 1), reply("a1", 2), userMessage("u2", 3), report("r1", 4)],
      working: true,
    });

    expect(shape(rows)).toEqual(["day", "u1", "a1", "u2", "working", "r1"]);
  });

  test("shows no working line once every message is answered", () => {
    const { rows } = rowsOf({ messages: [userMessage("u1", 1), reply("a1", 2)], working: false });

    expect(shape(rows)).not.toContain("working");
  });

  test("a reply that answers nothing on screen goes last", () => {
    const { rows } = rowsOf({
      messages: [userMessage("u1", 1), reply("a1", 2)],
      live: { a2: liveTurn("Early") },
      working: true,
    });

    expect(shape(rows)).toEqual(["day", "u1", "a1", "a2…", "working"]);
    expect(rows.at(-1)).toMatchObject({ kind: "working", since: null });
  });
});
