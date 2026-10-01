import { describe, expect, test } from "bun:test";
import {
  MessageBlockSchema,
  SUGGESTED_THREADS_MAX,
  SUGGESTION_REASON_MAX,
  threadCardVariant,
} from "./blocks.ts";
import { makePrArtifact, parsed, rejectedPaths } from "./test-utils.ts";
import { THREAD_STATUSES } from "./thread.ts";

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
    ["routing-receipt", { type: "routing-receipt", threadIds: ["thr_1", "thr_2", "thr_3"] }],
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

  test("a suggestion may carry one short line of reason, and an old one without it still reads", () => {
    const suggestion = { id: "s1", title: "Sketch the API", prompt: "Draft it.", repoId: null };
    const block = (reason?: string) => ({
      type: "suggested-threads",
      suggestions: [{ ...suggestion, ...(reason !== undefined && { reason }) }],
    });
    expect(parsed(MessageBlockSchema, block("Every client waits on it."))).toEqual(
      block("Every client waits on it."),
    );
    expect(parsed(MessageBlockSchema, block())).toEqual(block());
    expect(rejectedPaths(MessageBlockSchema, block(" "))).toEqual(["suggestions.0.reason"]);
    expect(rejectedPaths(MessageBlockSchema, block("x".repeat(SUGGESTION_REASON_MAX + 1)))).toEqual(
      ["suggestions.0.reason"],
    );
  });

  test("a suggestion carries the answer the host recorded: started as a thread, or skipped", () => {
    const suggestion = { id: "s1", title: "Sketch the API", prompt: "Draft it.", repoId: null };
    const answered = (answer: unknown) => ({
      type: "suggested-threads",
      suggestions: [{ ...suggestion, answer }],
    });
    for (const answer of [{ state: "started", threadId: "thr_1" }, { state: "skipped" }]) {
      expect(parsed(MessageBlockSchema, answered(answer))).toEqual(answered(answer));
    }
    expect(rejectedPaths(MessageBlockSchema, answered({ state: "started" }))).toEqual([
      "suggestions.0.answer.threadId",
    ]);
    expect(rejectedPaths(MessageBlockSchema, answered({ state: "done" }))).toEqual([
      "suggestions.0.answer.state",
    ]);
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

  test("rejects a routing receipt that names no thread or names one twice", () => {
    expect(rejectedPaths(MessageBlockSchema, { type: "routing-receipt", threadIds: [] })).toEqual([
      "threadIds",
    ]);
    expect(
      rejectedPaths(MessageBlockSchema, { type: "routing-receipt", threadIds: ["thr_1", "thr_1"] }),
    ).toEqual(["threadIds"]);
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

describe("threadCardVariant", () => {
  test("a thread waiting on the person is a needs-call card, work that will run is live, the rest is done", () => {
    const variants = Object.fromEntries(
      THREAD_STATUSES.map((status) => [status, threadCardVariant(status)]),
    );
    expect(variants).toEqual({
      "waiting-on-you": "needs-call",
      working: "live",
      queued: "live",
      "rate-limited": "live",
      landing: "live",
      "ready-for-review": "done",
      idle: "done",
      resolved: "done",
    });
  });
});
