import { describe, expect, test } from "bun:test";
import { THREAD_STATUSES } from "@aop/common";
import {
  attentionKind,
  attentionOf,
  attentionSentence,
  formatAge,
  groupProjects,
  groupThreads,
  hostConnection,
  matchesProjectSearch,
  matchesThreadSearch,
  overviewCounters,
  pullRequestOf,
  sortThreads,
  THREAD_STATUS_LABEL,
  THREAD_STATUS_ORDER,
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

const pr = (state: "open" | "merged" | "closed", number = 7) =>
  ({ type: "pr", number, url: `https://github.com/acme/app/pull/${number}`, state }) as const;

describe("THREAD_STATUS_ORDER", () => {
  test("lists every status once, questions first and closed work last", () => {
    expect(THREAD_STATUS_ORDER).toEqual([
      "waiting-on-you",
      "working",
      "queued",
      "rate-limited",
      "ready-for-review",
      "landing",
      "idle",
      "resolved",
    ]);
    expect([...THREAD_STATUS_ORDER].sort()).toEqual([...THREAD_STATUSES].sort());
  });
});

describe("groupThreads", () => {
  test("makes one group per status present, in the order of the statuses", () => {
    const groups = groupThreads([
      makeThread({ id: "r", status: "resolved" }),
      makeThread({ id: "w1", status: "working" }),
      makeThread({ id: "b", status: "waiting-on-you" }),
      makeThread({ id: "w2", status: "working" }),
    ]);

    expect(groups.map((group) => group.status)).toEqual(["waiting-on-you", "working", "resolved"]);
    expect(groups.map((group) => group.threads.length)).toEqual([1, 2, 1]);
  });

  test("puts the newest activity first inside a group", () => {
    const [group] = groupThreads([
      makeThread({ id: "old", status: "idle", lastActivityAt: "2026-09-29T09:00:00.000Z" }),
      makeThread({ id: "new", status: "idle", lastActivityAt: "2026-09-29T11:00:00.000Z" }),
    ]);

    expect(group?.threads.map((thread) => thread.id)).toEqual(["new", "old"]);
  });

  test("lists the queue in the order the host starts it, oldest first", () => {
    const groups = groupThreads([
      makeThread({ id: "third", status: "queued", lastActivityAt: "2026-09-29T11:00:00.000Z" }),
      makeThread({ id: "first", status: "queued", lastActivityAt: "2026-09-29T09:00:00.000Z" }),
      makeThread({ id: "second", status: "queued", lastActivityAt: "2026-09-29T10:00:00.000Z" }),
      makeThread({ id: "new-idle", status: "idle", lastActivityAt: "2026-09-29T11:00:00.000Z" }),
      makeThread({ id: "old-idle", status: "idle", lastActivityAt: "2026-09-29T09:00:00.000Z" }),
    ]);

    expect(groups[0]?.threads.map((thread) => thread.id)).toEqual(["first", "second", "third"]);
    expect(groups[1]?.threads.map((thread) => thread.id)).toEqual(["new-idle", "old-idle"]);
  });

  test("has no groups for no threads and does not reorder its input", () => {
    expect(groupThreads([])).toEqual([]);
    const input = [
      makeThread({ id: "b", status: "idle" }),
      makeThread({ id: "a", status: "working" }),
    ];
    groupThreads(input);
    expect(input.map((thread) => thread.id)).toEqual(["b", "a"]);
  });
});

describe("overviewCounters", () => {
  const threads = [
    makeThread({ id: "q", status: "waiting-on-you" }),
    makeThread({ id: "w", status: "working" }),
    makeThread({ id: "u", status: "queued" }),
    makeThread({ id: "l", status: "rate-limited" }),
    makeThread({ id: "r", status: "ready-for-review", artifacts: [pr("open", 1)] }),
    makeThread({ id: "g", status: "landing", artifacts: [pr("open", 2)] }),
    makeThread({ id: "i", status: "idle", artifacts: [pr("closed", 3)] }),
    makeThread({ id: "d", status: "resolved", artifacts: [pr("merged", 4)] }),
  ];

  test("counts what waits on the person, what runs now, what waits for review and what is done", () => {
    // Queued and rate-limited threads have no turn running, so they are not "running".
    expect(overviewCounters(threads)).toEqual({
      waiting: 1,
      running: 1,
      readyForReview: 1,
      openPullRequests: 2,
      resolved: 1,
    });
  });

  test("counts a thread once for its open pull request, however many documents it holds", () => {
    const counters = overviewCounters([
      makeThread({
        status: "idle",
        artifacts: [{ type: "doc", name: "A" }, pr("open"), { type: "doc", name: "B" }],
      }),
    ]);

    expect(counters.openPullRequests).toBe(1);
  });

  test("is all zero for no threads", () => {
    expect(overviewCounters([])).toEqual({
      waiting: 0,
      running: 0,
      readyForReview: 0,
      openPullRequests: 0,
      resolved: 0,
    });
  });
});

describe("pullRequestOf", () => {
  test("is the pull request a thread opened, in whatever state", () => {
    expect(pullRequestOf(makeThread({ artifacts: [pr("merged", 12)] }))).toMatchObject({
      number: 12,
      state: "merged",
    });
  });

  test("finds it among documents", () => {
    const found = pullRequestOf(
      makeThread({ artifacts: [{ type: "doc", name: "Notes" }, pr("open", 5)] }),
    );

    expect(found?.number).toBe(5);
    expect(found?.url).toBe("https://github.com/acme/app/pull/5");
  });

  test("is null for a thread with none, including one that only has documents", () => {
    expect(pullRequestOf(makeThread({ artifacts: [] }))).toBeNull();
    expect(pullRequestOf(makeThread({ artifacts: [{ type: "doc", name: "Notes" }] }))).toBeNull();
  });
});
