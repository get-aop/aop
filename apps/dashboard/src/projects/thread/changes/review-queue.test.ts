import { beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../../../test/setup-dom";

setupDashboardDom();

const {
  addThreadReviewComment,
  clearThreadReviewQueue,
  getThreadReviewQueue,
  removeThreadReviewComment,
  resetThreadReviewQueueCacheForTests,
  subscribeThreadReviewQueue,
  updateThreadReviewComment,
} = await import("./review-queue");

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
  resetThreadReviewQueueCacheForTests();
});

describe("thread review queue store", () => {
  test("add, update, remove, and clear mutate the per-thread queue", () => {
    const added = addThreadReviewComment("s1", sampleComment);
    expect(added.id.length).toBeGreaterThan(0);
    expect(getThreadReviewQueue("s1")).toHaveLength(1);
    expect(getThreadReviewQueue("s1")[0]?.note).toBe("why 3?");

    updateThreadReviewComment("s1", added.id, "actually fine");
    expect(getThreadReviewQueue("s1")[0]?.note).toBe("actually fine");

    const second = addThreadReviewComment("s1", { ...sampleComment, newNo: 9, note: "second" });
    removeThreadReviewComment("s1", added.id);
    expect(getThreadReviewQueue("s1")).toEqual([
      expect.objectContaining({ id: second.id, note: "second" }),
    ]);

    clearThreadReviewQueue("s1");
    expect(getThreadReviewQueue("s1")).toHaveLength(0);
  });

  test("queues are isolated per thread", () => {
    addThreadReviewComment("s1", sampleComment);
    addThreadReviewComment("s2", { ...sampleComment, note: "other thread" });
    expect(getThreadReviewQueue("s1")).toHaveLength(1);
    expect(getThreadReviewQueue("s2")).toHaveLength(1);
    expect(getThreadReviewQueue("s2")[0]?.note).toBe("other thread");
    expect(getThreadReviewQueue("s3")).toHaveLength(0);
    expect(getThreadReviewQueue(null)).toHaveLength(0);
  });

  test("round-trips through localStorage across a simulated reload", () => {
    addThreadReviewComment("s1", sampleComment);
    resetThreadReviewQueueCacheForTests();
    const reloaded = getThreadReviewQueue("s1");
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.path).toBe("src/a.ts");
    expect(reloaded[0]?.excerpt).toBe("const b = 3;");
  });

  test("corrupted localStorage JSON yields an empty queue", () => {
    localStorage.setItem("aop.thread-review-queue.s1", "{not json");
    expect(getThreadReviewQueue("s1")).toEqual([]);
    localStorage.setItem("aop.thread-review-queue.s2", JSON.stringify({ nope: true }));
    expect(getThreadReviewQueue("s2")).toEqual([]);
  });

  test("notifies subscribers on every mutation", () => {
    let calls = 0;
    const unsubscribe = subscribeThreadReviewQueue(() => {
      calls += 1;
    });
    const added = addThreadReviewComment("s1", sampleComment);
    updateThreadReviewComment("s1", added.id, "edited");
    removeThreadReviewComment("s1", added.id);
    expect(calls).toBe(3);
    unsubscribe();
    addThreadReviewComment("s1", sampleComment);
    expect(calls).toBe(3);
  });
});
