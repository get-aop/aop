import { describe, expect, test } from "bun:test";
import {
  LATER,
  makeBlockedQuestion,
  makePrArtifact,
  makeRuntimeSelection,
  makeThread,
  rejectedPaths,
} from "./test-utils.ts";
import {
  BlockedQuestionSchema,
  getThreadProgress,
  THREAD_STATUSES,
  type Thread,
  ThreadSchema,
} from "./thread.ts";

const validByStatus: [string, Record<string, unknown>][] = [
  ["waiting-on-you", { blockedQuestion: makeBlockedQuestion() }],
  ["working", {}],
  ["ready-for-review", { artifacts: [{ type: "doc", name: "Preset CTA Variants" }] }],
  ["landing", { artifacts: [makePrArtifact()] }],
  ["idle", {}],
  ["resolved", { resolvedAt: LATER, artifacts: [makePrArtifact({ state: "merged" })] }],
];

describe("ThreadSchema", () => {
  test("covers exactly the six statuses", () => {
    expect(THREAD_STATUSES).toEqual([
      "waiting-on-you",
      "working",
      "ready-for-review",
      "landing",
      "idle",
      "resolved",
    ]);
    expect(validByStatus.map(([status]) => status)).toEqual([...THREAD_STATUSES]);
  });

  test.each(validByStatus)("accepts a %s thread", (status, overrides) => {
    const thread = ThreadSchema.parse(makeThread({ status, ...overrides }));
    expect(thread.status).toBe(status as Thread["status"]);
    expect(thread.title).toBe("Fix 4s cold start regression");
  });

  test.each(["blocked", "failed", "done", ""])("rejects status %p", (status) => {
    expect(rejectedPaths(ThreadSchema, makeThread({ status }))).toEqual(["status"]);
  });

  describe("blockedQuestion belongs to waiting-on-you alone", () => {
    test("a waiting-on-you thread without a question is rejected", () => {
      expect(rejectedPaths(ThreadSchema, makeThread({ status: "waiting-on-you" }))).toEqual([
        "blockedQuestion",
      ]);
    });

    test.each(["working", "ready-for-review", "idle"])(
      "a %s thread carrying a question is rejected",
      (status) => {
        const thread = makeThread({ status, blockedQuestion: makeBlockedQuestion() });
        expect(rejectedPaths(ThreadSchema, thread)).toEqual(["blockedQuestion"]);
      },
    );

    test("a landing or resolved thread carrying a question is rejected", () => {
      const landing = makeThread({
        status: "landing",
        artifacts: [makePrArtifact()],
        blockedQuestion: makeBlockedQuestion(),
      });
      const resolved = makeThread({
        status: "resolved",
        resolvedAt: LATER,
        blockedQuestion: makeBlockedQuestion(),
      });
      expect(rejectedPaths(ThreadSchema, landing)).toEqual(["blockedQuestion"]);
      expect(rejectedPaths(ThreadSchema, resolved)).toEqual(["blockedQuestion"]);
    });
  });

  describe("resolvedAt belongs to resolved alone", () => {
    test("a resolved thread without resolvedAt is rejected", () => {
      expect(rejectedPaths(ThreadSchema, makeThread({ status: "resolved" }))).toEqual([
        "resolvedAt",
      ]);
    });

    test.each(["working", "idle", "ready-for-review"])(
      "a %s thread carrying resolvedAt is rejected",
      (status) => {
        expect(rejectedPaths(ThreadSchema, makeThread({ status, resolvedAt: LATER }))).toEqual([
          "resolvedAt",
        ]);
      },
    );
  });

  describe("landing needs a pull request", () => {
    test("rejects a landing thread with no artifacts", () => {
      expect(rejectedPaths(ThreadSchema, makeThread({ status: "landing" }))).toEqual(["artifacts"]);
    });

    test("rejects a landing thread whose only artifact is a document", () => {
      const thread = makeThread({
        status: "landing",
        artifacts: [{ type: "doc", name: "Notes" }],
      });
      expect(rejectedPaths(ThreadSchema, thread)).toEqual(["artifacts"]);
    });

    test("other statuses may have no pull request", () => {
      expect(ThreadSchema.safeParse(makeThread({ status: "ready-for-review" })).success).toBe(true);
    });
  });

  test("rejects a runtime outside the Claude Code catalog", () => {
    for (const provider of ["codex-cli", "pi", "opencode"]) {
      const thread = makeThread({ runtime: makeRuntimeSelection({ provider }) });
      expect(rejectedPaths(ThreadSchema, thread)).toEqual(["runtime.provider"]);
    }
  });

  test("rejects a target other than the host", () => {
    expect(rejectedPaths(ThreadSchema, makeThread({ target: { kind: "cloud" } }))).toEqual([
      "target.kind",
    ]);
  });

  test("rejects a malformed checklist step", () => {
    const steps = [
      { label: "Bisect", state: "spinning" },
      { label: " ", state: "done" },
    ];
    expect(rejectedPaths(ThreadSchema, makeThread({ steps }))).toEqual([
      "steps.0.state",
      "steps.1.label",
    ]);
  });

  test("bounds the title and the live status line, and allows no status line", () => {
    expect(rejectedPaths(ThreadSchema, makeThread({ title: " " }))).toEqual(["title"]);
    expect(rejectedPaths(ThreadSchema, makeThread({ liveStatusLine: "x".repeat(501) }))).toEqual([
      "liveStatusLine",
    ]);
    expect(ThreadSchema.safeParse(makeThread({ liveStatusLine: null })).success).toBe(true);
  });

  test("rejects negative or fractional reply counts and non-boolean unread", () => {
    expect(rejectedPaths(ThreadSchema, makeThread({ repliesCount: -1 }))).toEqual(["repliesCount"]);
    expect(rejectedPaths(ThreadSchema, makeThread({ repliesCount: 1.5 }))).toEqual([
      "repliesCount",
    ]);
    expect(rejectedPaths(ThreadSchema, makeThread({ unread: "yes" }))).toEqual(["unread"]);
  });

  test("rejects timestamps that are not ISO instants", () => {
    expect(rejectedPaths(ThreadSchema, makeThread({ lastActivityAt: "2h ago" }))).toEqual([
      "lastActivityAt",
    ]);
    expect(rejectedPaths(ThreadSchema, makeThread({ createdAt: "2026-09-29 10:00:00" }))).toEqual([
      "createdAt",
    ]);
  });

  test("a thread that has not started work has no repo, branch, or checklist yet", () => {
    const thread = makeThread({ repoId: null, branch: null, steps: [], liveStatusLine: null });
    expect(ThreadSchema.parse(thread)).toMatchObject({ repoId: null, branch: null, steps: [] });
  });

  test("narrowing on status is what exposes the question and the resolution time", () => {
    const thread: Thread = ThreadSchema.parse(
      makeThread({ status: "waiting-on-you", blockedQuestion: makeBlockedQuestion() }),
    );
    if (thread.status !== "waiting-on-you") {
      throw new Error("expected a waiting-on-you thread");
    }
    expect(thread.blockedQuestion.options).toHaveLength(2);

    const working: Thread = ThreadSchema.parse(makeThread());
    if (working.status !== "working") {
      throw new Error("expected a working thread");
    }
    // @ts-expect-error a working thread has no place to hold a blocked question
    const illegal: Thread = { ...working, blockedQuestion: makeBlockedQuestion() };
    expect(illegal.status).toBe("working");
  });
});

describe("BlockedQuestionSchema", () => {
  test("accepts two options with one recommended, and fills recommended with false", () => {
    const question = BlockedQuestionSchema.parse(makeBlockedQuestion());
    expect(question.options.map((option) => option.recommended)).toEqual([true, false]);
  });

  test("accepts an open question with no options", () => {
    expect(BlockedQuestionSchema.parse({ question: "Which region?", options: [] }).options).toEqual(
      [],
    );
  });

  test("rejects two recommended options", () => {
    const question = makeBlockedQuestion({
      options: [
        { label: "A", recommended: true },
        { label: "B", recommended: true },
      ],
    });
    expect(rejectedPaths(BlockedQuestionSchema, question)).toEqual(["options"]);
  });

  test("rejects an empty question or an empty option label", () => {
    expect(rejectedPaths(BlockedQuestionSchema, makeBlockedQuestion({ question: "  " }))).toEqual([
      "question",
    ]);
    expect(
      rejectedPaths(BlockedQuestionSchema, makeBlockedQuestion({ options: [{ label: "" }] })),
    ).toEqual(["options.0.label"]);
  });
});

describe("getThreadProgress", () => {
  test("counts done steps over all steps", () => {
    expect(getThreadProgress(ThreadSchema.parse(makeThread()))).toEqual({ done: 1, total: 3 });
  });

  test("is null until the thread has a checklist", () => {
    expect(getThreadProgress(ThreadSchema.parse(makeThread({ steps: [] })))).toBeNull();
  });

  test("reaches total/total when every step is done", () => {
    const steps = [
      { label: "One", state: "done" },
      { label: "Two", state: "done" },
    ];
    expect(getThreadProgress(ThreadSchema.parse(makeThread({ steps })))).toEqual({
      done: 2,
      total: 2,
    });
  });
});
