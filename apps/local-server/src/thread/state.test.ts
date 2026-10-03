import { describe, expect, test } from "bun:test";
import type { Thread } from "@aop/common";
import {
  canWaitOnRateLimit,
  closingStatusLine,
  pullRequestOf,
  QUEUED_STATUS_LINE,
  statusAfterSchedule,
  statusAfterTurn,
  statusChangeOf,
  type TurnEnd,
} from "./state.ts";

const RESUMES_AT = "2026-09-30T16:00:00.000Z";
const done = { label: "a", state: "done" } as const;
const pending = { label: "b", state: "pending" } as const;

const openPr = {
  type: "pr",
  number: 7,
  url: "https://github.com/acme/widget/pull/7",
  state: "open",
} as const;

const thread = (
  status: Thread["status"],
  steps: Thread["steps"] = [],
  artifacts: Thread["artifacts"] = [],
): Pick<Thread, "status" | "steps" | "artifacts"> => ({ status, steps, artifacts });

describe("statusAfterTurn", () => {
  test("a queued message keeps the thread working, whatever ended the turn", () => {
    for (const end of ["completed", "failed", "interrupted", "cancelled"] as TurnEnd[]) {
      expect(statusAfterTurn(thread("working"), end, true)).toEqual({ status: "working" });
    }
  });

  test("a completed turn with the whole checklist done is ready for review", () => {
    expect(statusAfterTurn(thread("working", [done, done]), "completed", false)).toEqual({
      status: "ready-for-review",
    });
  });

  test("a completed turn with work left, or with no checklist, is idle", () => {
    expect(statusAfterTurn(thread("working", [done, pending]), "completed", false)).toEqual({
      status: "idle",
    });
    expect(statusAfterTurn(thread("working"), "completed", false)).toEqual({ status: "idle" });
  });

  test("a completed turn with an open pull request is ready for review, a merged one is not", () => {
    expect(statusAfterTurn(thread("working", [], [openPr]), "completed", false)).toEqual({
      status: "ready-for-review",
    });
    expect(
      statusAfterTurn(thread("working", [], [{ ...openPr, state: "merged" }]), "completed", false),
    ).toEqual({ status: "idle" });
  });

  test("a failed turn is idle, not ready for review, even with a finished checklist", () => {
    expect(statusAfterTurn(thread("working", [done]), "failed", false)).toEqual({ status: "idle" });
  });

  test("a question that is pending survives a completed or failed turn", () => {
    expect(statusAfterTurn(thread("waiting-on-you", [done]), "completed", false)).toBeNull();
    expect(statusAfterTurn(thread("waiting-on-you"), "failed", false)).toBeNull();
  });

  test("stopping voids a pending question", () => {
    expect(statusAfterTurn(thread("waiting-on-you"), "cancelled", false)).toEqual({
      status: "idle",
    });
    expect(statusAfterTurn(thread("waiting-on-you"), "interrupted", false)).toEqual({
      status: "idle",
    });
  });

  test("a resolved thread and a landing one are not moved by a turn ending", () => {
    for (const status of ["resolved", "landing"] as const) {
      expect(statusAfterTurn(thread(status), "completed", false)).toBeNull();
      expect(statusAfterTurn(thread(status), "cancelled", false)).toBeNull();
      expect(statusAfterTurn(thread(status), "rate-limited", false, RESUMES_AT)).toBeNull();
    }
  });

  test("a rate limit puts the thread on hold until it resumes, with or without a message queued", () => {
    const hold = { status: "rate-limited", resumesAt: RESUMES_AT } as const;

    expect(statusAfterTurn(thread("working"), "rate-limited", false, RESUMES_AT)).toEqual(hold);
    expect(statusAfterTurn(thread("working", [done]), "rate-limited", true, RESUMES_AT)).toEqual(
      hold,
    );
    expect(statusAfterTurn(thread("queued"), "rate-limited", false, RESUMES_AT)).toEqual(hold);
  });

  test("a rate limit leaves a pending question alone, and without a resume time changes nothing", () => {
    expect(statusAfterTurn(thread("waiting-on-you"), "rate-limited", false, RESUMES_AT)).toBeNull();
    expect(statusAfterTurn(thread("working"), "rate-limited", false)).toBeNull();
  });
});

describe("statusAfterSchedule", () => {
  test("a turn that has to wait puts a working thread in the queue, with the reason on its line", () => {
    expect(statusAfterSchedule("working", "queued")).toEqual({
      status: "queued",
      liveStatusLine: QUEUED_STATUS_LINE,
    });
  });

  test("only a working thread is put in the queue", () => {
    for (const status of [
      "queued",
      "idle",
      "waiting-on-you",
      "rate-limited",
      "resolved",
    ] as const) {
      expect(statusAfterSchedule(status, "queued")).toBeNull();
    }
  });

  test("a turn that got its slot, or a wait that ended, makes a queued or rate-limited thread work", () => {
    for (const status of ["queued", "rate-limited"] as const) {
      expect(statusAfterSchedule(status, "running")).toEqual({
        status: "working",
        liveStatusLine: null,
      });
    }
  });

  test("a thread that is already working, or is not going to, is left as it is", () => {
    for (const status of ["working", "idle", "waiting-on-you", "ready-for-review"] as const) {
      expect(statusAfterSchedule(status, "running")).toBeNull();
    }
  });
});

describe("canWaitOnRateLimit", () => {
  test("a thread that is resolved, landing or waiting on a question cannot be put on hold", () => {
    for (const status of ["resolved", "landing", "waiting-on-you"] as const) {
      expect(canWaitOnRateLimit(status)).toBe(false);
    }
    for (const status of ["working", "queued", "idle", "ready-for-review"] as const) {
      expect(canWaitOnRateLimit(status)).toBe(true);
    }
  });
});

describe("closingStatusLine", () => {
  test("a finished turn shows the first line of what the thread said", () => {
    expect(closingStatusLine("completed", "\n  Fixed the cold start.\n\nDetails below.")).toBe(
      "Fixed the cold start.",
    );
  });

  test("a failure says so, and a stopped turn says stopped", () => {
    expect(closingStatusLine("failed", "Runtime exited with code 1")).toBe(
      "Failed: Runtime exited with code 1",
    );
    expect(closingStatusLine("cancelled", "Conversation stopped.")).toBe("Stopped");
    expect(closingStatusLine("interrupted", "")).toBe("Stopped");
  });

  test("a rate limit shows the wait as it was worded, not as a failure", () => {
    expect(
      closingStatusLine("rate-limited", "Paused: limit hit. Resuming automatically at 4 PM."),
    ).toBe("Paused: limit hit. Resuming automatically at 4 PM.");
  });

  test("a long line is cut to what fits under a title", () => {
    const line = closingStatusLine("completed", "x".repeat(500));
    expect(line).toHaveLength(200);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("pullRequestOf", () => {
  test("is the pull request artifact, or null for a thread without one", () => {
    expect(pullRequestOf({ artifacts: [{ type: "doc", name: "notes.md" }, openPr] })).toEqual({
      number: 7,
      url: "https://github.com/acme/widget/pull/7",
      state: "open",
    });
    expect(pullRequestOf({ artifacts: [] })).toBeNull();
  });
});

describe("statusChangeOf", () => {
  const base: Omit<Extract<Thread, { status: "idle" }>, "status"> = {
    id: "isess_1",
    projectId: "proj_1",
    title: "t",
    runtime: {
      provider: "claude-code",
      runtimeId: "claude-code",
      model: "claude-opus-4-8",
      effort: "high",
    },
    target: { kind: "host" },
    repoId: null,
    branch: null,
    steps: [],
    liveStatusLine: null,
    artifacts: [],
    repliesCount: 0,
    unread: false,
    lastActivityAt: "2026-09-30T09:00:00.000Z",
    createdAt: "2026-09-30T09:00:00.000Z",
  };

  test("restores the field only the waiting and resolved statuses carry", () => {
    const question = { question: "Which?", options: [] };
    expect(
      statusChangeOf({ ...base, status: "waiting-on-you", blockedQuestion: question }),
    ).toEqual({ status: "waiting-on-you", blockedQuestion: question });
    expect(
      statusChangeOf({ ...base, status: "resolved", resolvedAt: "2026-09-30T10:00:00.000Z" }),
    ).toEqual({ status: "resolved", resolvedAt: "2026-09-30T10:00:00.000Z" });
    expect(statusChangeOf({ ...base, status: "idle" })).toEqual({ status: "idle" });
    expect(statusChangeOf({ ...base, status: "queued" })).toEqual({ status: "queued" });
    expect(
      statusChangeOf({ ...base, status: "rate-limited", resumesAt: "2026-09-30T16:00:00.000Z" }),
    ).toEqual({ status: "rate-limited", resumesAt: "2026-09-30T16:00:00.000Z" });
  });
});
