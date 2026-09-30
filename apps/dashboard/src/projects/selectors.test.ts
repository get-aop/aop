import { describe, expect, test } from "bun:test";
import { THREAD_STATUSES } from "@aop/common";
import {
  attentionKind,
  attentionOf,
  attentionSentence,
  formatAge,
  groupProjects,
  hostConnection,
  matchesProjectSearch,
  matchesThreadSearch,
  sortThreads,
  THREAD_STATUS_LABEL,
} from "./selectors";
import { makeEntry, makeProject, makeState, makeThread } from "./test-utils";

describe("attention", () => {
  const threads = [
    makeThread({ id: "a", status: "waiting-on-you" }),
    makeThread({ id: "b", status: "working", unread: true }),
    makeThread({ id: "c", status: "working" }),
    makeThread({ id: "d", status: "idle" }),
  ];

  test("counts waiting, working and unread threads", () => {
    expect(attentionOf(threads)).toEqual({ waiting: 1, working: 2, unread: 1 });
  });

  test("a question outranks running work; nothing is none", () => {
    expect(attentionKind({ waiting: 1, working: 3, unread: 0 })).toBe("waiting");
    expect(attentionKind({ waiting: 0, working: 3, unread: 0 })).toBe("working");
    expect(attentionKind({ waiting: 0, working: 0, unread: 2 })).toBe("none");
  });

  test("the sentence reads like the Overview's subline", () => {
    expect(attentionSentence(0)).toBe("Nothing is waiting on you.");
    expect(attentionSentence(1)).toBe("1 thread is waiting on you.");
    expect(attentionSentence(3)).toBe("3 threads are waiting on you.");
  });
});

describe("sortThreads", () => {
  test("puts questions first and closed work last, newest first within a status", () => {
    const sorted = sortThreads([
      makeThread({ id: "resolved", status: "resolved" }),
      makeThread({
        id: "old-working",
        status: "working",
        lastActivityAt: "2026-09-29T09:00:00.000Z",
      }),
      makeThread({
        id: "new-working",
        status: "working",
        lastActivityAt: "2026-09-29T11:00:00.000Z",
      }),
      makeThread({ id: "idle", status: "idle" }),
      makeThread({ id: "blocked", status: "waiting-on-you" }),
      makeThread({ id: "review", status: "ready-for-review" }),
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual([
      "blocked",
      "new-working",
      "old-working",
      "review",
      "idle",
      "resolved",
    ]);
  });

  test("shows a thread waiting for a run slot or a rate limit after the ones doing work", () => {
    const sorted = sortThreads([
      makeThread({ id: "idle", status: "idle" }),
      makeThread({ id: "limited", status: "rate-limited" }),
      makeThread({ id: "queued", status: "queued" }),
      makeThread({ id: "working", status: "working" }),
    ]);
    expect(sorted.map((thread) => thread.id)).toEqual(["working", "queued", "limited", "idle"]);
  });

  test("names every status a thread can have", () => {
    for (const status of THREAD_STATUSES) {
      expect(THREAD_STATUS_LABEL[status]).toBeTruthy();
    }
    expect(THREAD_STATUS_LABEL.queued).toBe("Queued");
    expect(THREAD_STATUS_LABEL["rate-limited"]).toBe("Rate limited");
  });

  test("does not reorder the array it was given", () => {
    const input = [
      makeThread({ id: "b", status: "idle" }),
      makeThread({ id: "a", status: "working" }),
    ];
    sortThreads(input);
    expect(input.map((thread) => thread.id)).toEqual(["b", "a"]);
  });
});

describe("search", () => {
  const thread = makeThread({
    title: "Harden checkout",
    liveStatusLine: "Replaying prod traces",
    branch: "aop/harden",
  });

  test("matches title, status line, branch and status label, ignoring case", () => {
    for (const query of ["HARDEN", "traces", "aop/", "working"]) {
      expect(matchesThreadSearch(thread, query)).toBe(true);
    }
    expect(matchesThreadSearch(thread, "stripe")).toBe(false);
    expect(matchesThreadSearch(thread, "   ")).toBe(true);
  });

  test("matches a blocked thread by its question", () => {
    const blocked = makeThread({ status: "waiting-on-you" });
    expect(matchesThreadSearch(blocked, "which database")).toBe(true);
  });

  test("projects match by name or goal", () => {
    const entry = makeEntry(makeProject({ name: "Storefront", goal: "Faster pricing page" }));
    expect(matchesProjectSearch(entry, "store")).toBe(true);
    expect(matchesProjectSearch(entry, "pricing")).toBe(true);
    expect(matchesProjectSearch(entry, "billing")).toBe(false);
  });
});

describe("groupProjects", () => {
  const entries = [
    makeEntry(makeProject({ id: "old", updatedAt: "2026-09-29T08:00:00.000Z" })),
    makeEntry(makeProject({ id: "new", updatedAt: "2026-09-29T12:00:00.000Z" })),
    makeEntry(makeProject({ id: "pinned", updatedAt: "2026-09-29T07:00:00.000Z" })),
    makeEntry(makeProject({ id: "shelved", status: "archived" })),
  ];

  test("pinned projects lead, each group newest first, archived kept apart", () => {
    const groups = groupProjects(entries, ["pinned"]);
    expect(groups.pinned.map((e) => e.project.id)).toEqual(["pinned"]);
    expect(groups.active.map((e) => e.project.id)).toEqual(["new", "old"]);
    expect(groups.archived.map((e) => e.project.id)).toEqual(["shelved"]);
  });

  test("an archived project stays archived even when pinned", () => {
    const groups = groupProjects(entries, ["shelved"]);
    expect(groups.pinned).toEqual([]);
    expect(groups.archived).toHaveLength(1);
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-09-29T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  test("uses the terse ages of the Overview", () => {
    expect(formatAge(ago(10_000), now)).toBe("now");
    expect(formatAge(ago(5 * 60_000), now)).toBe("5m");
    expect(formatAge(ago(3 * 3_600_000), now)).toBe("3h");
    expect(formatAge(ago(2 * 86_400_000), now)).toBe("2d");
  });

  test("a time in the future reads as now", () => {
    expect(formatAge(ago(-60_000), now)).toBe("now");
  });
});

describe("hostConnection", () => {
  test("offline when the list cannot be fetched, reconnecting while any stream retries", () => {
    const live = makeEntry(makeProject(), [], { connection: "live" });
    const retrying = makeEntry(makeProject({ id: "b" }), [], { connection: "reconnecting" });

    expect(hostConnection(makeState([live]))).toBe("connected");
    expect(hostConnection(makeState([live, retrying]))).toBe("reconnecting");
    expect(hostConnection(makeState([live, retrying], { reachable: false }))).toBe("offline");
    expect(hostConnection(makeState([]))).toBe("connected");
  });
});
