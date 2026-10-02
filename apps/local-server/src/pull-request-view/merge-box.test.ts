import { describe, expect, test } from "bun:test";
import { checksOf } from "./checks.ts";
import { type MergeBoxInput, mergeBoxOf } from "./merge-box.ts";
import type { RawCheckContext } from "./queries.ts";
import { type BranchRules, NO_RULES } from "./rules.ts";
import { checkRun, rawPullRequest, rawRepo } from "./test-utils.ts";

const boxOf = (
  head: Partial<MergeBoxInput["head"]> = {},
  {
    contexts = [checkRun("test", "COMPLETED", "SUCCESS", { isRequired: true })],
    rules = NO_RULES,
    repo = rawRepo(),
    unresolvedThreads = 0,
  }: {
    contexts?: RawCheckContext[];
    rules?: BranchRules;
    repo?: MergeBoxInput["repo"];
    unresolvedThreads?: number;
  } = {},
) =>
  mergeBoxOf({
    head: { ...rawPullRequest(), ...head },
    repo,
    checks: checksOf(rawPullRequest({ contexts })),
    unresolvedThreads,
    rules,
  });

const kinds = (box: ReturnType<typeof boxOf>) => box.blockers.map((blocker) => blocker.kind);

describe("the merge box", () => {
  test("a clean pull request with its required check passing is ready, with every method", () => {
    const box = boxOf();
    expect(box).toEqual({
      status: "ready",
      blockers: [],
      warnings: [],
      conflicts: "none",
      methods: ["squash", "merge", "rebase"],
      missingRequiredChecks: [],
    });
  });

  test("a draft is blocked until it is marked ready", () => {
    const box = boxOf({ isDraft: true, mergeStateStatus: "DRAFT" });
    expect(box.status).toBe("blocked");
    expect(kinds(box)).toEqual(["draft"]);
  });

  test("conflicts block, whether GitHub says CONFLICTING or DIRTY", () => {
    expect(kinds(boxOf({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }))).toEqual([
      "conflicts",
    ]);
    const dirty = boxOf({ mergeable: "UNKNOWN", mergeStateStatus: "DIRTY" });
    expect(dirty.conflicts).toBe("conflicting");
    expect(kinds(dirty)).toEqual(["conflicts"]);
  });

  test("while GitHub computes mergeability, the merge waits", () => {
    const box = boxOf({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" });
    expect(box.conflicts).toBe("unknown");
    expect(kinds(box)).toEqual(["computing"]);
  });

  test("a branch behind a base that requires up-to-date branches is blocked", () => {
    expect(kinds(boxOf({ mergeStateStatus: "BEHIND" }))).toEqual(["behind"]);
  });

  test("reviews: changes requested, or approvals the rules require", () => {
    expect(
      kinds(boxOf({ reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BLOCKED" })),
    ).toEqual(["changes_requested"]);
    const required = boxOf(
      { reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED" },
      { rules: { ...NO_RULES, requiredApprovals: 2 } },
    );
    expect(required.blockers).toEqual([
      {
        kind: "review_required",
        title: "Review required",
        detail: "At least 2 approving reviews are required by reviewers with write access.",
      },
    ]);
  });

  test("required checks that failed or still run block; optional ones only warn", () => {
    const box = boxOf(
      { mergeStateStatus: "BLOCKED" },
      {
        contexts: [
          checkRun("unit", "COMPLETED", "FAILURE", { isRequired: true }),
          checkRun("e2e", "IN_PROGRESS", null, { isRequired: true }),
          checkRun("lint", "COMPLETED", "TIMED_OUT"),
          checkRun("docs", "QUEUED", null),
        ],
      },
    );
    expect(kinds(box)).toEqual(["checks_failing", "checks_pending"]);
    expect(box.blockers[0]).toMatchObject({
      title: "1 required check failed",
      detail: "build / unit",
    });
    expect(box.blockers[1]).toMatchObject({ title: "1 required check has not finished" });
    expect(box.warnings).toEqual([
      "1 check failed: build / lint",
      "1 check still running: build / docs",
    ]);
  });

  test("an optional check that failed leaves the merge ready, with a warning", () => {
    const box = boxOf(
      { mergeStateStatus: "UNSTABLE" },
      { contexts: [checkRun("lint", "COMPLETED", "FAILURE")] },
    );
    expect(box.status).toBe("ready");
    expect(box.warnings).toEqual(["1 check failed: build / lint"]);
  });

  test("a check the rules require that never reported is expected", () => {
    const box = boxOf(
      { mergeStateStatus: "BLOCKED" },
      { rules: { ...NO_RULES, requiredChecks: ["ci", "test"] } },
    );
    expect(box.missingRequiredChecks).toEqual(["ci"]);
    expect(box.blockers).toEqual([
      {
        kind: "checks_missing",
        title: "1 required check expected",
        detail: "Waiting for status to be reported: ci",
      },
    ]);
  });

  test("unresolved conversations block only when the rules say so", () => {
    expect(kinds(boxOf({}, { unresolvedThreads: 2 }))).toEqual([]);
    const box = boxOf(
      { mergeStateStatus: "BLOCKED" },
      { unresolvedThreads: 2, rules: { ...NO_RULES, requireThreadResolution: true } },
    );
    expect(box.blockers).toEqual([
      expect.objectContaining({ kind: "unresolved_threads", title: "2 unresolved conversations" }),
    ]);
  });

  test("GitHub's BLOCKED with no reason AOP can name still blocks, as the rules", () => {
    const box = boxOf({ mergeStateStatus: "BLOCKED" });
    expect(box.status).toBe("blocked");
    expect(box.blockers).toEqual([
      {
        kind: "rules",
        title: "Merging is blocked",
        detail: "The base branch's protection rules don't allow this merge yet.",
      },
    ]);
  });

  test("methods are what both the repository and the rules allow; none left blocks", () => {
    const narrowed = boxOf(
      {},
      {
        repo: rawRepo({ rebaseMergeAllowed: false }),
        rules: { ...NO_RULES, allowedMethods: ["squash", "rebase"] },
      },
    );
    expect(narrowed.methods).toEqual(["squash"]);
    expect(narrowed.status).toBe("ready");

    const none = boxOf({}, { rules: { ...NO_RULES, allowedMethods: [] } });
    expect(none.methods).toEqual([]);
    expect(kinds(none)).toEqual(["not_allowed"]);
  });

  test("every reason is listed together, in GitHub's order", () => {
    const box = boxOf(
      {
        isDraft: true,
        mergeable: "CONFLICTING",
        mergeStateStatus: "BEHIND",
        reviewDecision: "REVIEW_REQUIRED",
      },
      {
        contexts: [checkRun("unit", "COMPLETED", "FAILURE", { isRequired: true })],
        rules: { ...NO_RULES, requiredChecks: ["ci"] },
      },
    );
    expect(kinds(box)).toEqual([
      "draft",
      "conflicts",
      "behind",
      "review_required",
      "checks_failing",
      "checks_missing",
    ]);
  });

  test("a merged or closed pull request is done, whatever its checks say", () => {
    for (const state of ["MERGED", "CLOSED"] as const) {
      const box = boxOf({ state, mergeStateStatus: "BLOCKED" });
      expect(box.status).toBe("done");
      expect(box.blockers).toEqual([]);
    }
  });
});
