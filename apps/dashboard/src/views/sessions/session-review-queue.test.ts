import { beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const {
  addSessionReviewComment,
  clearSessionReviewQueue,
  getSessionReviewQueue,
  removeSessionReviewComment,
  resetSessionReviewQueueCacheForTests,
  restoreSessionReviewQueueIfEmpty,
  subscribeSessionReviewQueue,
  updateSessionReviewComment,
} = await import("./session-review-queue");

const sampleComment = {
  path: "src/a.ts",
  lineType: "add" as const,
  oldNo: null,
  newNo: 4,
  excerpt: "const b = 3;",
  note: "why 3?",
};

beforeEach(() => {
  localStorage.clear();
  resetSessionReviewQueueCacheForTests();
});

describe("session review queue store", () => {
  test("add, update, remove, and clear mutate the per-session queue", () => {
    const added = addSessionReviewComment("s1", sampleComment);
    expect(added.id.length).toBeGreaterThan(0);
    expect(getSessionReviewQueue("s1")).toHaveLength(1);
    expect(getSessionReviewQueue("s1")[0]?.note).toBe("why 3?");

    updateSessionReviewComment("s1", added.id, "actually fine");
    expect(getSessionReviewQueue("s1")[0]?.note).toBe("actually fine");

    const second = addSessionReviewComment("s1", { ...sampleComment, newNo: 9, note: "second" });
    removeSessionReviewComment("s1", added.id);
    expect(getSessionReviewQueue("s1")).toEqual([
      expect.objectContaining({ id: second.id, note: "second" }),
    ]);

    clearSessionReviewQueue("s1");
    expect(getSessionReviewQueue("s1")).toHaveLength(0);
  });

  test("queues are isolated per session", () => {
    addSessionReviewComment("s1", sampleComment);
    addSessionReviewComment("s2", { ...sampleComment, note: "other session" });
    expect(getSessionReviewQueue("s1")).toHaveLength(1);
    expect(getSessionReviewQueue("s2")).toHaveLength(1);
    expect(getSessionReviewQueue("s2")[0]?.note).toBe("other session");
    expect(getSessionReviewQueue("s3")).toHaveLength(0);
    expect(getSessionReviewQueue(null)).toHaveLength(0);
  });

  test("round-trips through localStorage across a simulated reload", () => {
    addSessionReviewComment("s1", sampleComment);
    resetSessionReviewQueueCacheForTests();
    const reloaded = getSessionReviewQueue("s1");
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.path).toBe("src/a.ts");
    expect(reloaded[0]?.excerpt).toBe("const b = 3;");
  });

  test("corrupted localStorage JSON yields an empty queue", () => {
    localStorage.setItem("aop.session-review-queue.s1", "{not json");
    expect(getSessionReviewQueue("s1")).toEqual([]);
    localStorage.setItem("aop.session-review-queue.s2", JSON.stringify({ nope: true }));
    expect(getSessionReviewQueue("s2")).toEqual([]);
  });

  test("restoreSessionReviewQueueIfEmpty only restores into an empty queue", () => {
    const snapshot = [addSessionReviewComment("s1", sampleComment)];
    clearSessionReviewQueue("s1");
    restoreSessionReviewQueueIfEmpty("s1", snapshot);
    expect(getSessionReviewQueue("s1")).toHaveLength(1);

    const newer = addSessionReviewComment("s1", { ...sampleComment, note: "newer" });
    restoreSessionReviewQueueIfEmpty("s1", snapshot);
    const notes = getSessionReviewQueue("s1").map((comment) => comment.note);
    expect(notes).toContain("newer");
    expect(getSessionReviewQueue("s1")).toHaveLength(2);
    removeSessionReviewComment("s1", newer.id);
  });

  test("notifies subscribers on every mutation", () => {
    let calls = 0;
    const unsubscribe = subscribeSessionReviewQueue(() => {
      calls += 1;
    });
    const added = addSessionReviewComment("s1", sampleComment);
    updateSessionReviewComment("s1", added.id, "edited");
    removeSessionReviewComment("s1", added.id);
    expect(calls).toBe(3);
    unsubscribe();
    addSessionReviewComment("s1", sampleComment);
    expect(calls).toBe(3);
  });
});
