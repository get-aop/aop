import { describe, expect, test } from "bun:test";
import type { SessionReviewComment } from "./session-review-queue";
import { reviewCommentLineLabel, serializeReviewMessage } from "./session-review-serializer";

const comment = (overrides: Partial<SessionReviewComment>): SessionReviewComment => ({
  id: "c1",
  path: "src/a.ts",
  lineType: "add",
  oldNo: null,
  newNo: 4,
  excerpt: "const b = 3;",
  note: "why 3?",
  createdAt: 1,
  ...overrides,
});

describe("reviewCommentLineLabel", () => {
  test("prefers newNo, falls back to old line form", () => {
    expect(reviewCommentLineLabel({ oldNo: 2, newNo: 4 })).toBe("4");
    expect(reviewCommentLineLabel({ oldNo: 12, newNo: null })).toBe("old line 12");
  });
});

describe("serializeReviewMessage", () => {
  test("returns user text unchanged when queue is empty", () => {
    expect(serializeReviewMessage([], "hello there")).toBe("hello there");
    expect(serializeReviewMessage([], "")).toBe("");
  });

  test("single comment without user text ends after the note", () => {
    expect(serializeReviewMessage([comment({})], "")).toBe(
      "Review comments on the current diff:\n\n### src/a.ts:4\n```\nconst b = 3;\n```\nwhy 3?",
    );
  });

  test("appends user text after a blank line", () => {
    expect(serializeReviewMessage([comment({})], "please fix")).toBe(
      "Review comments on the current diff:\n\n### src/a.ts:4\n```\nconst b = 3;\n```\nwhy 3?\n\nplease fix",
    );
  });

  test("orders by path then line then insertion", () => {
    const comments = [
      comment({ id: "c1", path: "src/b.ts", newNo: 2, excerpt: "b2", note: "note b" }),
      comment({ id: "c2", path: "src/a.ts", newNo: 9, excerpt: "a9", note: "note a9" }),
      comment({ id: "c3", path: "src/a.ts", newNo: 3, excerpt: "a3", note: "note a3" }),
    ];
    expect(serializeReviewMessage(comments, "")).toBe(
      [
        "Review comments on the current diff:",
        "",
        "### src/a.ts:3",
        "```",
        "a3",
        "```",
        "note a3",
        "",
        "### src/a.ts:9",
        "```",
        "a9",
        "```",
        "note a9",
        "",
        "### src/b.ts:2",
        "```",
        "b2",
        "```",
        "note b",
      ].join("\n"),
    );
  });

  test("del rows render the old line form", () => {
    const del = comment({ lineType: "del", oldNo: 12, newNo: null, excerpt: "gone", note: "keep" });
    expect(serializeReviewMessage([del], "")).toBe(
      "Review comments on the current diff:\n\n### src/a.ts:old line 12\n```\ngone\n```\nkeep",
    );
  });

  test("uses a four-backtick fence when the excerpt contains three backticks", () => {
    const fenced = comment({ excerpt: 'const s = "```";', note: "tricky" });
    expect(serializeReviewMessage([fenced], "")).toBe(
      'Review comments on the current diff:\n\n### src/a.ts:4\n````\nconst s = "```";\n````\ntricky',
    );
  });

  test("fence grows past the longest backtick run in the excerpt", () => {
    const fenced = comment({ excerpt: "a ```` b\nstill here", note: "four ticks inside" });
    expect(serializeReviewMessage([fenced], "")).toBe(
      "Review comments on the current diff:\n\n### src/a.ts:4\n`````\na ```` b\nstill here\n`````\nfour ticks inside",
    );
  });
});
