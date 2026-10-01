import { describe, expect, test } from "bun:test";
import type { MessageBlock } from "@aop/common";
import {
  chipIndexOf,
  groupBlocks,
  type InlineBlock,
  proseOf,
  threadChipOf,
  withThreadChips,
} from "./inline-run";

const text = (value: string): MessageBlock => ({ type: "text", text: value });
const chip = (threadId: string): MessageBlock => ({ type: "thread-chip", threadId });
const card = (threadId: string): MessageBlock => ({
  type: "thread-card",
  threadId,
  variant: "live",
});
const receipt: MessageBlock = { type: "routing-receipt", threadIds: ["thr_1"] };

describe("proseOf", () => {
  test("joins the text as written and stands a link in for each chip, in order", () => {
    const run: InlineBlock[] = [
      { type: "text", text: "Sent your note to " },
      { type: "thread-chip", threadId: "thr_1" },
      { type: "text", text: " and " },
      { type: "pr-chip", number: 7, url: "https://github.com/acme/app/pull/7", state: "open" },
      { type: "text", text: "." },
    ];

    const { markdown, chips } = proseOf(run);

    expect(markdown).toBe(
      "Sent your note to [chip](https://chip.aop.invalid/0) and [chip](https://chip.aop.invalid/1).",
    );
    expect(chips.map((entry) => entry.type)).toEqual(["thread-chip", "pr-chip"]);
  });

  test("prose without chips is its text and no chips", () => {
    expect(proseOf([{ type: "text", text: "Done." }])).toEqual({ markdown: "Done.", chips: [] });
  });
});

describe("chipIndexOf", () => {
  test("reads the index a chip link carries and nothing else", () => {
    expect(chipIndexOf("https://chip.aop.invalid/3")).toBe(3);
    expect(chipIndexOf("https://chip.aop.invalid/x")).toBeNull();
    expect(chipIndexOf("https://chip.aop.invalid/-1")).toBeNull();
    expect(chipIndexOf("https://example.com/3")).toBeNull();
    expect(chipIndexOf(undefined)).toBeNull();
  });
});

describe("groupBlocks", () => {
  test("a run of text and chips is one paragraph, and each other block stands alone", () => {
    const groups = groupBlocks([text("On it. "), chip("thr_1"), text(" is on it."), card("thr_1")]);

    expect(groups.map((group) => group.kind)).toEqual(["prose", "block"]);
    expect(groups[0]).toMatchObject({ kind: "prose", run: [{}, {}, {}] });
  });

  test("blocks keep the order they were written in: what the tools posted follows the reply", () => {
    const groups = groupBlocks([text("Started."), card("thr_1"), receipt]);

    expect(groups.map((group) => (group.kind === "block" ? group.block.type : "prose"))).toEqual([
      "prose",
      "thread-card",
      "routing-receipt",
    ]);
  });

  test("blocks between prose keep the prose apart", () => {
    const groups = groupBlocks([text("One."), card("thr_1"), text("Two.")]);

    expect(groups.map((group) => group.kind)).toEqual(["prose", "block", "prose"]);
  });
});

describe("thread links", () => {
  test("point at the chip address, which names the thread, and nothing else changes", () => {
    const markdown = withThreadChips(
      "See [Fix login](thread:isess_01ab) and [docs](https://x.dev).",
    );

    expect(markdown).toBe(
      "See [Fix login](https://chip.aop.invalid/thread/isess_01ab) and [docs](https://x.dev).",
    );
    expect(threadChipOf("https://chip.aop.invalid/thread/isess_01ab")).toBe("isess_01ab");
    expect(threadChipOf("https://chip.aop.invalid/3")).toBeNull();
    expect(chipIndexOf("https://chip.aop.invalid/thread/isess_01ab")).toBeNull();
  });

  test("a link still being written is left for the markdown renderer to finish", () => {
    expect(withThreadChips("See [Fix login](thread:isess_0")).toBe(
      "See [Fix login](thread:isess_0",
    );
  });
});

describe("tool calls and reasoning in groups", () => {
  const tool = (id: string): MessageBlock => ({
    type: "tool",
    id,
    name: "Bash",
    detail: null,
    status: "done",
  });

  test("calls one after another are one group, named by where it starts", () => {
    const groups = groupBlocks([
      text("A"),
      tool("t1"),
      tool("t2"),
      { type: "thinking", text: "x" },
      text("B"),
    ]);

    expect(groups.map((group) => [group.kind, group.at])).toEqual([
      ["prose", 0],
      ["tools", 1],
      ["block", 3],
      ["prose", 4],
    ]);
  });

  test("each group is named by where it starts in the message", () => {
    const groups = groupBlocks([text("Started."), receipt]);

    expect(groups.map((group) => group.at)).toEqual([0, 1]);
  });
});
