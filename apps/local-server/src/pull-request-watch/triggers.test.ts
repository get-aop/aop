import { describe, expect, test } from "bun:test";
import type { GhPullRequestCheck, GhReview } from "../github-cli/index.ts";
import { checkRunKey } from "./check-runs.ts";
import { findTriggers, type Snapshot } from "./triggers.ts";

const check = (overrides: Partial<GhPullRequestCheck> = {}): GhPullRequestCheck => ({
  name: "test",
  workflow: "ci",
  state: "FAILURE",
  bucket: "fail",
  link: "https://github.com/acme/widget/actions/runs/100/job/1",
  startedAt: "2026-09-30T12:00:00Z",
  completedAt: "2026-09-30T12:05:00Z",
  description: "",
  ...overrides,
});

const passing = (name: string) => check({ name, state: "SUCCESS", bucket: "pass" });
const running = (name: string) =>
  check({ name, state: "PENDING", bucket: "pending", completedAt: null });

const review = (overrides: Partial<GhReview> = {}): GhReview => ({
  id: 11,
  state: "CHANGES_REQUESTED",
  body: "Please rename this.",
  author: "alice",
  association: "COLLABORATOR",
  ...overrides,
});

const snapshot = (overrides: {
  checks?: GhPullRequestCheck[] | null;
  reviews?: GhReview[];
  mergeable?: string;
  headSha?: string;
}): Snapshot => ({
  head: {
    state: "OPEN",
    mergeable: overrides.mergeable ?? "MERGEABLE",
    headSha: overrides.headSha ?? "abc123",
    baseRefName: "main",
  },
  checks: overrides.checks
    ? { reported: true, checks: overrides.checks }
    : { reported: false, checks: [] },
  reviews: overrides.reviews ?? [],
});

const none = new Set<string>();

describe("failing checks", () => {
  test("are a trigger once nothing is still running, and name every failure", () => {
    const failures = [check({ name: "test" }), check({ name: "lint" })];

    const triggers = findTriggers(snapshot({ checks: [...failures, passing("build")] }), none);

    expect(triggers).toEqual([
      {
        kind: "checks",
        keys: failures.map((failure) => checkRunKey(failure, "abc123")),
        checks: failures,
      },
    ]);
  });

  test("wait for the round to finish: a check still running is no trigger yet", () => {
    expect(findTriggers(snapshot({ checks: [check(), running("lint")] }), none)).toEqual([]);
  });

  test("a repository without checks, or with green ones, has nothing to fix", () => {
    expect(findTriggers(snapshot({ checks: null }), none)).toEqual([]);
    expect(findTriggers(snapshot({ checks: [passing("test")] }), none)).toEqual([]);
  });

  test("a gate that waits for a human approval is not something a push can fix", () => {
    const gate = check({ name: "PR review approver" });

    expect(findTriggers(snapshot({ checks: [gate, passing("test")] }), none)).toEqual([]);
  });

  test("a run that was answered is not a trigger again, and a new run of the same check is", () => {
    const answered = check();
    const handled = new Set([checkRunKey(answered, "abc123")]);
    expect(findTriggers(snapshot({ checks: [answered] }), handled)).toEqual([]);

    const rerun = check({
      link: "https://github.com/acme/widget/actions/runs/101/job/1",
      completedAt: "2026-09-30T12:20:00Z",
    });
    expect(checkRunKey(rerun, "abc123")).not.toBe(checkRunKey(answered, "abc123"));
    expect(findTriggers(snapshot({ checks: [rerun] }), handled)).toEqual([
      { kind: "checks", keys: [checkRunKey(rerun, "abc123")], checks: [rerun] },
    ]);
  });

  test("a commit status that fails again on the next commit, with the same link and times, is a new failure", () => {
    const status = check({
      link: "https://cla.example.com/pr/7",
      startedAt: null,
      completedAt: null,
    });
    const answered = new Set([checkRunKey(status, "abc123")]);

    expect(findTriggers(snapshot({ checks: [status], headSha: "abc123" }), answered)).toEqual([]);
    expect(findTriggers(snapshot({ checks: [status], headSha: "def456" }), answered)).toHaveLength(
      1,
    );
  });

  test("the same run read twice has one key, whatever else about the read changed", () => {
    expect(checkRunKey(check(), "abc123")).toBe(
      checkRunKey(check({ description: "took 5m" }), "abc123"),
    );
  });
});

describe("requested changes", () => {
  test("only a review that asks for changes is a trigger, and once", () => {
    const requested = review();
    const reviews = [
      review({ id: 9, state: "COMMENTED" }),
      review({ id: 10, state: "APPROVED" }),
      requested,
    ];

    expect(findTriggers(snapshot({ reviews }), none)).toEqual([
      { kind: "review", keys: ["review:11"], reviews: [requested] },
    ]);
    expect(findTriggers(snapshot({ reviews }), new Set(["review:11"]))).toEqual([]);
  });

  test("only from someone who works on the repository: a stranger's request is text nobody asked the agent to act on", () => {
    const trusted = ["OWNER", "MEMBER", "COLLABORATOR"].map((association, index) =>
      review({ id: 20 + index, author: `trusted-${index}`, association }),
    );
    const strangers = ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE", "MANNEQUIN"].map(
      (association, index) => review({ id: 30 + index, author: `stranger-${index}`, association }),
    );

    const found = findTriggers(snapshot({ reviews: [...strangers, ...trusted] }), none);

    expect(found).toEqual([
      { kind: "review", keys: ["review:20", "review:21", "review:22"], reviews: trusted },
    ]);
    expect(findTriggers(snapshot({ reviews: strangers }), none)).toEqual([]);
  });

  test("what a reviewer said stands until they say something else: a request they later approved is not asked for", () => {
    const requested = review({ id: 11, author: "alice" });
    const approved = review({ id: 12, author: "alice", state: "APPROVED" });
    const commented = review({ id: 13, author: "alice", state: "COMMENTED" });

    expect(findTriggers(snapshot({ reviews: [requested, approved] }), none)).toEqual([]);
    // Nor does a later comment bring it back, or take it away.
    expect(findTriggers(snapshot({ reviews: [requested, approved, commented] }), none)).toEqual([]);
    expect(findTriggers(snapshot({ reviews: [requested, commented] }), none)).toEqual([
      { kind: "review", keys: ["review:11"], reviews: [requested] },
    ]);
    // Someone else approving does not answer alice; alice asking again replaces her first request.
    const bob = review({ id: 14, author: "bob", state: "APPROVED" });
    const again = review({ id: 15, author: "alice" });
    expect(findTriggers(snapshot({ reviews: [requested, bob] }), none)).toHaveLength(1);
    expect(findTriggers(snapshot({ reviews: [again, requested, bob] }), none)).toEqual([
      { kind: "review", keys: ["review:15"], reviews: [again] },
    ]);
  });

  test("two new requests are one trigger; a dismissed one is not", () => {
    const first = review({ id: 11 });
    const second = review({ id: 12, author: "bob" });
    const dismissed = review({ id: 13, author: "carol", state: "DISMISSED" });
    const carolAsked = review({ id: 10, author: "carol" });

    expect(findTriggers(snapshot({ reviews: [first, second] }), none)).toEqual([
      { kind: "review", keys: ["review:11", "review:12"], reviews: [first, second] },
    ]);
    expect(findTriggers(snapshot({ reviews: [carolAsked, dismissed] }), none)).toEqual([]);
  });
});

describe("conflicts", () => {
  test("are a trigger for the head commit that conflicts, once", () => {
    const conflicting = snapshot({ mergeable: "CONFLICTING", headSha: "abc123" });

    expect(findTriggers(conflicting, none)).toEqual([
      { kind: "conflict", keys: ["conflict:abc123"], base: "main" },
    ]);
    expect(findTriggers(conflicting, new Set(["conflict:abc123"]))).toEqual([]);
    // A push that still conflicts is a new head, and a new attempt.
    expect(
      findTriggers(
        snapshot({ mergeable: "CONFLICTING", headSha: "def456" }),
        new Set(["conflict:abc123"]),
      ),
    ).toHaveLength(1);
  });

  test("GitHub still working it out, or a clean merge, is no trigger", () => {
    expect(findTriggers(snapshot({ mergeable: "UNKNOWN" }), none)).toEqual([]);
    expect(findTriggers(snapshot({ mergeable: "MERGEABLE" }), none)).toEqual([]);
  });
});

test("everything wrong at once is answered together, in the order checks, review, conflict", () => {
  const found = findTriggers(
    snapshot({ checks: [check()], reviews: [review()], mergeable: "CONFLICTING" }),
    none,
  );

  expect(found.map((trigger) => trigger.kind)).toEqual(["checks", "review", "conflict"]);
});
