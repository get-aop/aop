import { describe, expect, test } from "bun:test";
import { MessageBlockSchema, SUGGESTED_THREADS_MAX } from "./blocks.ts";
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

  test("accepts suggested threads and rejects an empty, oversized, or duplicated list", () => {
    const suggestion = (id: string) => ({
      id,
      title: "Audit the retry logic",
      prompt: "Read the retry code and list every place a retry can double-charge.",
      repoId: "repo_1",
    });
    const block = (suggestions: unknown[]) => ({ type: "suggested-threads", suggestions });
    expect(parsed(MessageBlockSchema, block([suggestion("s1"), suggestion("s2")]))).toEqual(
      block([suggestion("s1"), suggestion("s2")]),
    );
    expect(rejectedPaths(MessageBlockSchema, block([]))).toEqual(["suggestions"]);
    expect(rejectedPaths(MessageBlockSchema, block([suggestion("s1"), suggestion("s1")]))).toEqual([
      "suggestions",
    ]);
    const nine = Array.from({ length: SUGGESTED_THREADS_MAX + 1 }, (_, i) => suggestion(`s${i}`));
    expect(rejectedPaths(MessageBlockSchema, block(nine))).toEqual(["suggestions"]);
  });

  test("a suggestion may name no repo but needs a title and a prompt", () => {
    const suggestions = [{ id: "s1", title: "Sketch the API", prompt: "Draft it.", repoId: null }];
    expect(MessageBlockSchema.safeParse({ type: "suggested-threads", suggestions }).success).toBe(
      true,
    );
    const blank = [{ id: "s1", title: " ", prompt: "", repoId: null }];
    expect(
      rejectedPaths(MessageBlockSchema, { type: "suggested-threads", suggestions: blank }),
    ).toEqual(["suggestions.0.title", "suggestions.0.prompt"]);
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
