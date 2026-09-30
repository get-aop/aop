import { describe, expect, test } from "bun:test";
import { MessageBlockSchema } from "./blocks.ts";
import { makePrArtifact, parsed, rejectedPaths } from "./test-utils.ts";

const prChip = () => {
  const { type: _artifactType, ...pullRequest } = makePrArtifact();
  return { type: "pr-chip", ...pullRequest };
};

describe("MessageBlockSchema", () => {
  test.each([
    ["text", { type: "text", text: "On it. Three threads." }],
    ["thread-chip", { type: "thread-chip", threadId: "thr_1" }],
    ["pr-chip", prChip()],
    ["thread-card", { type: "thread-card", threadId: "thr_1", variant: "live" }],
    ["routing-receipt", { type: "routing-receipt", count: 3 }],
    ["quote-forwarded", { type: "quote-forwarded", text: "release moved to Monday" }],
  ])("accepts a %s block", (_type, block) => {
    expect(parsed(MessageBlockSchema, block)).toEqual(block);
  });

  test.each(["live", "needs-call", "done"])("accepts the %s thread card variant", (variant) => {
    const block = { type: "thread-card", threadId: "thr_1", variant };
    expect(parsed(MessageBlockSchema, block)).toEqual(block);
  });

  test("rejects a thread card variant that is not live, needs-call, or done", () => {
    const block = { type: "thread-card", threadId: "thr_1", variant: "blocked" };
    expect(rejectedPaths(MessageBlockSchema, block)).toEqual(["variant"]);
  });

  test("rejects an unknown block type", () => {
    expect(rejectedPaths(MessageBlockSchema, { type: "delegation-card", id: "x" })).toEqual([
      "type",
    ]);
  });

  test("rejects a thread card or chip with no thread to point at", () => {
    expect(rejectedPaths(MessageBlockSchema, { type: "thread-card", variant: "live" })).toEqual([
      "threadId",
    ]);
    expect(rejectedPaths(MessageBlockSchema, { type: "thread-chip", threadId: "" })).toEqual([
      "threadId",
    ]);
  });

  test("rejects a routing receipt for zero, negative, or fractional thread counts", () => {
    for (const count of [0, -1, 1.5]) {
      expect(rejectedPaths(MessageBlockSchema, { type: "routing-receipt", count })).toEqual([
        "count",
      ]);
    }
  });

  test("rejects empty text and an empty forwarded quote", () => {
    expect(rejectedPaths(MessageBlockSchema, { type: "text", text: "" })).toEqual(["text"]);
    expect(rejectedPaths(MessageBlockSchema, { type: "quote-forwarded", text: "" })).toEqual([
      "text",
    ]);
  });

  test("rejects a pr chip whose pull request number is not positive", () => {
    expect(rejectedPaths(MessageBlockSchema, { ...prChip(), number: 0 })).toEqual(["number"]);
  });
});
