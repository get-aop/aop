import { describe, expect, test } from "bun:test";
import type { TurnPart } from "@aop/common";
import { finalizeTurnParts, storedTurnParts, turnText } from "./turn-parts.ts";

const text = (value: string): TurnPart => ({ type: "text", text: value });
const tool = (status: "running" | "done" | "failed", id = "t1"): TurnPart => ({
  type: "tool",
  id,
  name: "Bash",
  detail: "bun test",
  status,
});

describe("finalizeTurnParts", () => {
  test("keeps what the turn said on the way and ends with the final answer it already wrote", () => {
    const parts = [
      text("Looking at the retry code."),
      tool("done"),
      text("Fixed: one retry, not two."),
    ];
    expect(finalizeTurnParts(parts, { text: "Fixed: one retry, not two." })).toEqual(parts);
  });

  test("matches the final answer despite surrounding whitespace, and across paragraphs", () => {
    const parts = [
      text("First.\n\n"),
      { type: "thinking", text: "hm" } as TurnPart,
      text("Second."),
    ];
    expect(finalizeTurnParts(parts, { text: "  First.\n\nSecond.\n" })).toEqual(parts);
  });

  test("replaces a last paragraph the log cut short with the whole final answer", () => {
    expect(
      finalizeTurnParts([tool("done"), text("Fixed: one re")], { text: "Fixed: one retry." }),
    ).toEqual([tool("done"), text("Fixed: one retry.")]);
  });

  test("appends what the host says when the run failed, and fails the calls left running", () => {
    expect(
      finalizeTurnParts([text("Running the tests."), tool("running")], {
        text: "Runtime error: the CLI exited with code 1",
        failed: true,
      }),
    ).toEqual([
      text("Running the tests."),
      tool("failed"),
      text("Runtime error: the CLI exited with code 1"),
    ]);
  });

  test("a stopped turn keeps what it wrote and says it was stopped", () => {
    expect(
      finalizeTurnParts([text("Halfway")], { text: "Conversation stopped.", aborted: true }),
    ).toEqual([text("Halfway"), text("Conversation stopped.")]);
  });

  test("a turn interrupted for the next message keeps what it wrote, and says so only when it wrote nothing", () => {
    const interrupted = { text: "Interrupted — applying your next message.", interrupted: true };
    expect(finalizeTurnParts([text("Halfway"), tool("running")], interrupted)).toEqual([
      text("Halfway"),
      tool("failed"),
    ]);
    expect(finalizeTurnParts([tool("done")], interrupted)).toEqual([
      tool("done"),
      text("Interrupted — applying your next message."),
    ]);
  });

  test("a turn that streamed nothing is its final text, and a completed run finishes its calls", () => {
    expect(finalizeTurnParts([], { text: "OK" })).toEqual([text("OK")]);
    expect(finalizeTurnParts([tool("running")], { text: "" })).toEqual([tool("done")]);
  });

  test("does not take a short accidental overlap for the final answer", () => {
    expect(finalizeTurnParts([text("Done")], { text: "Done with the second half too." })).toEqual([
      text("Done with the second half too."),
    ]);
    expect(finalizeTurnParts([text("All good")], { text: "OK" })).toEqual([
      text("All good"),
      text("OK"),
    ]);
  });
});

describe("turnText", () => {
  test("is the prose parts in order, one paragraph each", () => {
    expect(
      turnText([text(" A "), tool("done"), { type: "thinking", text: "x" }, text("B\n")]),
    ).toBe("A\n\nB");
  });
});

describe("storedTurnParts", () => {
  test("reads the parts a reply was stored with, skipping one it cannot read", () => {
    const raw = JSON.stringify([text("Hi"), { type: "tool", id: "" }, tool("done")]);
    expect(storedTurnParts({ parts: raw, activity: null }, "ignored")).toEqual([
      text("Hi"),
      tool("done"),
    ]);
    expect(storedTurnParts({ parts: "not json", activity: null }, "x")).toEqual([]);
  });

  test("a reply with neither parts nor activity is its text", () => {
    expect(storedTurnParts({ parts: null, activity: null }, " Done. ")).toEqual([text("Done.")]);
    expect(storedTurnParts({ parts: null, activity: null }, "")).toEqual([]);
  });

  test("a reply stored before parts existed is read from its activity: reasoning, paragraphs, calls, answer", () => {
    const activity = JSON.stringify({
      thinking: "Plan it.",
      content: "Looking around.\n\nFixed it.",
      commandGroups: [
        {
          id: "cg_1",
          commands: [
            { id: "c1", command: "Bash", detail: "git status", status: "done", exitCode: 0 },
            { id: "c2", command: "Read", status: "running" },
            { nope: true },
          ],
        },
        "junk",
      ],
    });
    expect(storedTurnParts({ parts: null, activity }, "Fixed it.")).toEqual([
      { type: "thinking", text: "Plan it." },
      text("Looking around."),
      { type: "tool", id: "c1", name: "Bash", detail: "git status", status: "done" },
      { type: "tool", id: "c2", name: "Read", detail: null, status: "failed" },
      text("Fixed it."),
    ]);
  });

  test("a stopped legacy reply, whose activity does not end with its text, leaves its paragraphs out", () => {
    const activity = JSON.stringify({ thinking: "", content: "Halfway", commandGroups: [] });
    expect(storedTurnParts({ parts: null, activity }, "Conversation stopped.")).toEqual([
      text("Conversation stopped."),
    ]);
    expect(storedTurnParts({ parts: null, activity }, "")).toEqual([text("Halfway")]);
  });

  test("unreadable legacy activity falls back to the text", () => {
    expect(storedTurnParts({ parts: null, activity: "{" }, "Hi")).toEqual([text("Hi")]);
  });
});
