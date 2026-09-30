import { describe, expect, test } from "bun:test";
import { textToBlocks } from "./text-blocks.ts";

describe("textToBlocks", () => {
  test("text with no thread link is one text block, untouched", () => {
    expect(textToBlocks("I see no threads yet.")).toEqual([
      { type: "text", text: "I see no threads yet." },
    ]);
    expect(textToBlocks("See [the docs](https://example.com) and `thread:x`.")).toEqual([
      { type: "text", text: "See [the docs](https://example.com) and `thread:x`." },
    ]);
  });

  test("a thread link becomes a chip in the middle of the sentence, spaces kept", () => {
    expect(
      textToBlocks("Passed it to [Fix login](thread:isess_01abc); it will redate the draft."),
    ).toEqual([
      { type: "text", text: "Passed it to " },
      { type: "thread-chip", threadId: "isess_01abc" },
      { type: "text", text: "; it will redate the draft." },
    ]);
  });

  test("several links, at the start and the end, leave no empty text blocks", () => {
    expect(textToBlocks("[A](thread:a) and [B](thread:b)")).toEqual([
      { type: "thread-chip", threadId: "a" },
      { type: "text", text: " and " },
      { type: "thread-chip", threadId: "b" },
    ]);
  });

  test("a link whose label is empty or whose id is missing is left as written", () => {
    expect(textToBlocks("[](thread:a)")).toEqual([{ type: "thread-chip", threadId: "a" }]);
    expect(textToBlocks("[A](thread:)")).toEqual([{ type: "text", text: "[A](thread:)" }]);
  });
});
