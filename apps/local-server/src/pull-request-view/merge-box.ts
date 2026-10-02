import type {
  PullRequestMergeBlocker,
  PullRequestMergeMethod,
  PullRequestViewCheck,
  PullRequestViewChecks,
  PullRequestViewMergeBox,
} from "@aop/common";
import type { RawHead, RawRepo } from "./queries.ts";
import type { BranchRules } from "./rules.ts";

export interface MergeBoxInput {
  head: Pick<RawHead, "state" | "isDraft" | "mergeable" | "mergeStateStatus" | "reviewDecision">;
  repo: Pick<RawRepo, "mergeCommitAllowed" | "squashMergeAllowed" | "rebaseMergeAllowed">;
  checks: PullRequestViewChecks;
  unresolvedThreads: number;
  rules: BranchRules;
}

/**
 * GitHub's merge box: whether the pull request can merge now and, if not, every reason, in the
 * order GitHub lists them. AOP never forces a merge past these (no `--admin`); the person sees
 * why and fixes it, or merges on GitHub.
 */
export const mergeBoxOf = (input: MergeBoxInput): PullRequestViewMergeBox => {
  const { head, checks } = input;
  const methods = allowedMethods(input);
  const missingRequiredChecks = missingChecks(input.rules, checks.items);
  const conflicts = conflictsOf(head);
  if (head.state !== "OPEN") {
    return {
      status: "done",
      blockers: [],
      warnings: [],
      conflicts,
      methods,
      missingRequiredChecks,
    };
  }
  const blockers = [
    ...stateBlockers(input, conflicts),
    ...checkBlockers(checks.items, missingRequiredChecks),
    ...ruleBlockers(input, methods),
  ];
  // GitHub knows of rules AOP cannot read (classic protection, rulesets on other refs): when it
  // says the merge is blocked and nothing above says why, say that much.
  if (blockers.length === 0 && head.mergeStateStatus === "BLOCKED") {
    blockers.push({
      kind: "rules",
      title: "Merging is blocked",
      detail: "The base branch's protection rules don't allow this merge yet.",
    });
  }
  return {
    status: blockers.length > 0 ? "blocked" : "ready",
    blockers,
    warnings: warningsOf(checks.items),
    conflicts,
    methods,
    missingRequiredChecks,
  };
};

const conflictsOf = (head: MergeBoxInput["head"]): PullRequestViewMergeBox["conflicts"] => {
  if (head.mergeable === "CONFLICTING" || head.mergeStateStatus === "DIRTY") return "conflicting";
  return head.mergeable === "MERGEABLE" ? "none" : "unknown";
};

const stateBlockers = (
  { head, rules }: MergeBoxInput,
  conflicts: PullRequestViewMergeBox["conflicts"],
): PullRequestMergeBlocker[] => {
  const blockers: PullRequestMergeBlocker[] = [];
  if (head.isDraft) {
    blockers.push({
      kind: "draft",
      title: "This pull request is still a work in progress",
      detail: "Draft pull requests cannot be merged. Mark it ready for review first.",
    });
  }
  if (conflicts === "conflicting") {
    blockers.push({
      kind: "conflicts",
      title: "This branch has conflicts that must be resolved",
      detail: "Resolve them on the branch (or on GitHub) and push.",
    });
  } else if (conflicts === "unknown") {
    blockers.push({
      kind: "computing",
      title: "Checking for the ability to merge automatically…",
      detail: "GitHub is still working it out; refresh in a moment.",
    });
  }
  if (head.mergeStateStatus === "BEHIND") {
    blockers.push({
      kind: "behind",
      title: "This branch is out-of-date with the base branch",
      detail: "The base branch requires branches to be up to date before merging.",
    });
  }
  if (head.reviewDecision === "CHANGES_REQUESTED") {
    blockers.push({
      kind: "changes_requested",
      title: "Changes requested",
      detail: "A reviewer with write access asked for changes.",
    });
  } else if (head.reviewDecision === "REVIEW_REQUIRED") {
    const count = Math.max(rules.requiredApprovals, 1);
    blockers.push({
      kind: "review_required",
      title: "Review required",
      detail: `At least ${count} approving review${count === 1 ? " is" : "s are"} required by reviewers with write access.`,
    });
  }
  return blockers;
};

const checkBlockers = (
  items: PullRequestViewCheck[],
  missing: string[],
): PullRequestMergeBlocker[] => {
  const required = items.filter((check) => check.required);
  const failing = required.filter((check) => ["failure", "cancelled"].includes(check.status));
  const pending = required.filter((check) => ["queued", "in_progress"].includes(check.status));
  const blockers: PullRequestMergeBlocker[] = [];
  if (failing.length > 0) {
    blockers.push({
      kind: "checks_failing",
      title: `${plural(failing.length, "required check")} failed`,
      detail: names(failing),
    });
  }
  if (pending.length > 0) {
    blockers.push({
      kind: "checks_pending",
      title: `${plural(pending.length, "required check")} ${pending.length === 1 ? "has" : "have"} not finished`,
      detail: names(pending),
    });
  }
  if (missing.length > 0) {
    blockers.push({
      kind: "checks_missing",
      title: `${plural(missing.length, "required check")} expected`,
      detail: `Waiting for status to be reported: ${missing.join(", ")}`,
    });
  }
  return blockers;
};

const ruleBlockers = (
  { rules, unresolvedThreads }: MergeBoxInput,
  methods: PullRequestMergeMethod[],
): PullRequestMergeBlocker[] => {
  const blockers: PullRequestMergeBlocker[] = [];
  if (rules.requireThreadResolution && unresolvedThreads > 0) {
    blockers.push({
      kind: "unresolved_threads",
      title: `${plural(unresolvedThreads, "unresolved conversation")}`,
      detail: "The base branch's rules require all conversations to be resolved.",
    });
  }
  if (methods.length === 0) {
    blockers.push({
      kind: "not_allowed",
      title: "No merge method is allowed",
      detail: "The repository's settings and the base branch's rules leave no way to merge.",
    });
  }
  return blockers;
};

const allowedMethods = ({ repo, rules }: MergeBoxInput): PullRequestMergeMethod[] => {
  const enabled: PullRequestMergeMethod[] = [];
  if (repo.squashMergeAllowed) enabled.push("squash");
  if (repo.mergeCommitAllowed) enabled.push("merge");
  if (repo.rebaseMergeAllowed) enabled.push("rebase");
  return rules.allowedMethods === null
    ? enabled
    : enabled.filter((method) => rules.allowedMethods?.includes(method));
};

const missingChecks = (rules: BranchRules, items: PullRequestViewCheck[]): string[] =>
  rules.requiredChecks.filter((name) => !items.some((check) => check.name === name));

const warningsOf = (items: PullRequestViewCheck[]): string[] => {
  const optional = items.filter((check) => !check.required);
  const failing = optional.filter((check) => ["failure", "cancelled"].includes(check.status));
  const pending = optional.filter((check) => ["queued", "in_progress"].includes(check.status));
  const warnings: string[] = [];
  if (failing.length > 0)
    warnings.push(`${plural(failing.length, "check")} failed: ${names(failing)}`);
  if (pending.length > 0)
    warnings.push(`${plural(pending.length, "check")} still running: ${names(pending)}`);
  return warnings;
};

const names = (checks: PullRequestViewCheck[]): string =>
  checks
    .map((check) => (check.workflow ? `${check.workflow} / ${check.name}` : check.name))
    .join(", ");

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
