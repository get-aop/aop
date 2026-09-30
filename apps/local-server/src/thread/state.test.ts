import { describe, expect, test } from "bun:test";
import type { Thread } from "@aop/common";
import { closingStatusLine, statusAfterTurn, type TurnEnd } from "./state.ts";

const done = { label: "a", state: "done" } as const;
const pending = { label: "b", state: "pending" } as const;

const thread = (
  status: Thread["status"],
  steps: Thread["steps"] = [],
): Pick<Thread, "status" | "steps"> => ({ status, steps });

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

  test("a long line is cut to what fits under a title", () => {
    const line = closingStatusLine("completed", "x".repeat(500));
    expect(line).toHaveLength(200);
    expect(line.endsWith("…")).toBe(true);
  });
});
