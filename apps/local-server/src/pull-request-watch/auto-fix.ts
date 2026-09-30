import type { ThreadStatus } from "@aop/common";
import { getLogger } from "@aop/infra";
import { type GhRead, type GhReviewComment, listReviewComments } from "../github-cli/index.ts";
import { recordThreadUpserted } from "../project/events.ts";
import { createThreadRepository } from "../thread/repository.ts";
import type { WatchEnv, WatchTarget } from "./env.ts";
import { attemptsOf, handledKeys, hasKind, newFix, newReport } from "./ledger.ts";
import { failureLogs } from "./logs.ts";
import { buildFixPrompt, describeTriggers } from "./prompts.ts";
import { capStatusLine, reportInTransaction } from "./reports.ts";
import { createWatchRepository } from "./repository.ts";
import { findTriggers, type Snapshot, type Trigger } from "./triggers.ts";

const logger = getLogger("pull-request-watch", "auto-fix");

export type FixResult =
  /** Nothing to answer, auto-fix is off, or the watcher already gave up on this thread. */
  | { kind: "none" }
  /** Something to answer, but the thread is busy: it is asked again once it is at rest. */
  | { kind: "deferred" }
  | { kind: "sent" }
  | { kind: "gave-up" }
  | { kind: "failed"; message: string; rateLimited: boolean };

const NONE: FixResult = { kind: "none" };
const DEFERRED: FixResult = { kind: "deferred" };

// A thread with a turn running or waiting, a wait on a limit, or a question for the person is
// not interrupted: a prompt would queue behind its turn, end its wait or answer its question.
const AT_REST: readonly ThreadStatus[] = ["idle", "ready-for-review"];

/**
 * Answers what is wrong with the thread's open pull request, once: a failing round of checks, a
 * review that asks for changes, a conflict. The answer is a message to the thread, sent the way a
 * person's is, so the run queue and the worktree rules apply. Each answer is one attempt, and
 * after `maxAttempts` the watcher stops and reports to the coordinator instead.
 */
export const autoFix = async (
  env: WatchEnv,
  target: WatchTarget,
  snapshot: Snapshot,
): Promise<FixResult> => {
  if (!target.project.autoFixPullRequests) return NONE;
  const entries = await env.repository.entries(target.thread.id);
  if (hasKind(entries, "cap")) return NONE;
  const triggers = findTriggers(snapshot, handledKeys(entries));
  if (triggers.length === 0) return NONE;
  if (!(await isAtRest(env, target.thread.id))) return DEFERRED;
  const attempts = attemptsOf(entries);
  return attempts >= env.maxAttempts
    ? giveUp(env, target, triggers, attempts)
    : sendFix(env, target, triggers, attempts + 1);
};

const isAtRest = async (env: WatchEnv, threadId: string): Promise<boolean> => {
  const thread = await env.ctx.threadRepository.getById(threadId);
  return thread !== null && AT_REST.includes(thread.status);
};

// The fix is written down before it is sent and confirmed after, so a crash between the two is
// settled by the next poll (the thread has the message or it does not) and never sent twice.
const sendFix = async (
  env: WatchEnv,
  target: WatchTarget,
  triggers: Trigger[],
  attempt: number,
): Promise<FixResult> => {
  const { thread, pullRequest } = target;
  const comments = await reviewComments(env, target, triggers);
  if (!comments.ok) {
    return { kind: "failed", message: comments.message, rateLimited: comments.rateLimited };
  }
  const prompt = buildFixPrompt({
    pullRequest,
    attempt,
    maxAttempts: env.maxAttempts,
    triggers,
    comments: comments.value,
    logs: await failedRunLogs(env, target, triggers),
  });
  const fix = newFix(
    triggers.flatMap((trigger) => trigger.keys),
    prompt.summary,
    env.now(),
  );
  if (!(await env.repository.claimFix(thread.id, fix, env.maxAttempts))) return NONE;

  // The status is asked again as the message is stored, since the reads above take a while: a
  // thread resolved or asked something meanwhile must not be reopened or answered by a fix.
  const sent = await env.send(
    thread.id,
    prompt.text,
    { type: "pull-request-watch", claimId: fix.id },
    { onlyIn: AT_REST },
  );
  if (!sent.success) {
    await env.repository.releaseFix(thread.id, fix.id);
    if (sent.error.code === "THREAD_BUSY") return DEFERRED;
    return {
      kind: "failed",
      message: `The fix was not sent: ${sent.error.code}`,
      rateLimited: false,
    };
  }
  await env.repository.confirmFix(thread.id, fix.id);
  logger.info(
    "Sent fix attempt {attempt} of {maxAttempts} to thread {threadId} for pull request #{number}: {summary}",
    {
      attempt,
      maxAttempts: env.maxAttempts,
      threadId: thread.id,
      number: pullRequest.number,
      summary: prompt.summary,
    },
  );
  return { kind: "sent" };
};

// The reviewers' line comments are only read when a review is being answered.
const reviewComments = async (
  env: WatchEnv,
  { repo, pullRequest }: WatchTarget,
  triggers: readonly Trigger[],
): Promise<GhRead<GhReviewComment[]>> =>
  triggers.some((trigger) => trigger.kind === "review")
    ? listReviewComments(env.runGh, repo.path, pullRequest.number)
    : { ok: true, value: [] };

// What the failing runs printed, for a thread that may not be able to run commands to read it.
const failedRunLogs = async (
  env: WatchEnv,
  { repo }: WatchTarget,
  triggers: readonly Trigger[],
): Promise<Record<string, string>> => {
  const failing = triggers.flatMap((trigger) => (trigger.kind === "checks" ? trigger.checks : []));
  return failing.length > 0 ? failureLogs(env.runGh, repo.path, failing) : {};
};

// One report, in the transaction that writes it down. The thread's line says why it stopped, and
// it is marked unread, and moved up, for the person to find.
const giveUp = async (
  env: WatchEnv,
  target: WatchTarget,
  triggers: readonly Trigger[],
  attempts: number,
): Promise<FixResult> => {
  const { thread } = target;
  const summary = describeTriggers(triggers);
  const tries = attempts === 1 ? "1 attempt" : `${attempts} attempts`;
  const woken = await env.ctx.eventPublisher.transaction(async (tx) => {
    await createWatchRepository(tx.db).record(thread.id, newReport("cap", summary, env.now()));
    await createThreadRepository(tx.db).update(thread.id, {
      liveStatusLine: capStatusLine(tries, summary),
      unread: true,
      lastActivityAt: new Date().toISOString(),
    });
    await recordThreadUpserted(tx, thread.id);
    return reportInTransaction(tx, target, "cap", `${tries}; still open: ${summary}`);
  });
  await env.wake(woken);
  logger.warn(
    "Gave up on pull request #{number} of thread {threadId} after {attempts} attempts: {summary}",
    { number: target.pullRequest.number, threadId: thread.id, attempts, summary },
  );
  return { kind: "gave-up" };
};
