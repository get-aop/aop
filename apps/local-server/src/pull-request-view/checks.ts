import type { PullRequestViewCheck, PullRequestViewChecks } from "@aop/common";
import { itemsOf, type RawCheckContext, type RawHead } from "./queries.ts";

/** The head commit's checks, each in one vocabulary, and what they add up to. */
export const checksOf = (head: Pick<RawHead, "headCommit">): PullRequestViewChecks => {
  const rollup = itemsOf(head.headCommit)[0]?.commit.statusCheckRollup;
  const items = itemsOf(rollup?.contexts).map(checkOf).sort(byAttention);
  return summarize(items);
};

export const summarize = (items: PullRequestViewCheck[]): PullRequestViewChecks => {
  const count = (statuses: PullRequestViewCheck["status"][]) =>
    items.filter((item) => statuses.includes(item.status)).length;
  const failing = count(["failure", "cancelled"]);
  const pending = count(["queued", "in_progress"]);
  return {
    state: stateOf(items.length, failing, pending),
    total: items.length,
    successful: count(["success", "neutral"]),
    failing,
    pending,
    skipped: count(["skipped"]),
    items,
  };
};

/** A commit's own rollup, as the Commits tab marks it. */
export const rollupState = (
  state: string | undefined,
): "pending" | "success" | "failure" | null => {
  if (state === undefined) return null;
  if (state === "SUCCESS") return "success";
  return state === "PENDING" || state === "EXPECTED" ? "pending" : "failure";
};

const stateOf = (
  total: number,
  failing: number,
  pending: number,
): PullRequestViewChecks["state"] => {
  if (total === 0) return "none";
  if (failing > 0) return "failure";
  return pending > 0 ? "pending" : "success";
};

const checkOf = (context: RawCheckContext): PullRequestViewCheck =>
  context.__typename === "CheckRun"
    ? {
        name: context.name,
        workflow:
          context.checkSuite?.workflowRun?.workflow.name ?? context.checkSuite?.app?.name ?? null,
        status: checkRunStatus(context.status, context.conclusion ?? null),
        required: context.isRequired === true,
        url: context.detailsUrl ?? null,
        description: null,
        startedAt: context.startedAt ?? null,
        completedAt: context.completedAt ?? null,
      }
    : {
        name: context.context,
        workflow: null,
        status: STATUS_CONTEXT[context.state] ?? "queued",
        required: context.isRequired === true,
        url: context.targetUrl ?? null,
        description: context.description ?? null,
        startedAt: context.createdAt ?? null,
        completedAt: null,
      };

const CONCLUSION: Record<string, PullRequestViewCheck["status"]> = {
  SUCCESS: "success",
  NEUTRAL: "neutral",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
  STALE: "cancelled",
};

const checkRunStatus = (
  status: string,
  conclusion: string | null,
): PullRequestViewCheck["status"] => {
  if (status === "IN_PROGRESS") return "in_progress";
  if (status !== "COMPLETED") return "queued";
  // FAILURE, TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE and anything GitHub adds later.
  return CONCLUSION[conclusion ?? ""] ?? "failure";
};

const STATUS_CONTEXT: Record<string, PullRequestViewCheck["status"]> = {
  SUCCESS: "success",
  FAILURE: "failure",
  ERROR: "failure",
  PENDING: "in_progress",
  EXPECTED: "queued",
};

// Failing first, then running, then the rest, as GitHub's merge box lists them.
const ATTENTION: Record<PullRequestViewCheck["status"], number> = {
  failure: 0,
  cancelled: 1,
  in_progress: 2,
  queued: 3,
  success: 4,
  neutral: 5,
  skipped: 6,
};

const byAttention = (a: PullRequestViewCheck, b: PullRequestViewCheck): number =>
  ATTENTION[a.status] - ATTENTION[b.status] || a.name.localeCompare(b.name);
