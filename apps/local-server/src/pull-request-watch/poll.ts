import { getLogger } from "@aop/infra";
import { recordThreadUpserted } from "../project/events.ts";
import { createThreadRepository } from "../thread/repository.ts";
import { pullRequestOf } from "../thread/state.ts";
import { autoFix } from "./auto-fix.ts";
import { summarizeChecks } from "./check-runs.ts";
import type { WatchEnv, WatchTarget } from "./env.ts";
import { hasKind, newReport } from "./ledger.ts";
import { publishChecks } from "./publish.ts";
import { isCapStatusLine, reportInTransaction } from "./reports.ts";
import { createWatchRepository } from "./repository.ts";
import { readSnapshot } from "./snapshot.ts";

const logger = getLogger("pull-request-watch", "poll");

export type PollResult =
  /** Nothing to watch: the pull request is not open any more, or the thread is being merged. */
  | { kind: "skipped" }
  /** `changed`: the watcher published, sent or reported something. `pending`: its checks are still running. */
  | { kind: "polled"; changed: boolean; pending: boolean }
  | { kind: "failed"; message: string; rateLimited: boolean };

const SKIPPED: PollResult = { kind: "skipped" };

/**
 * One look at a thread's open pull request: reads it from GitHub, puts what its checks add up to
 * on the thread, and either answers what is wrong with it or, once it merged or closed, reports
 * that and brings the thread in line. Every step can be run again after a crash: a fix that was
 * sent is never sent again, and a merge goes through the landing the merge route uses.
 */
export const pollPullRequest = async (env: WatchEnv, threadId: string): Promise<PollResult> => {
  const target = await loadTarget(env, threadId);
  if (!target) return SKIPPED;
  await env.repository.reconcileFixes(threadId);

  const read = await readSnapshot(env.runGh, target.repo.path, target.pullRequest.number);
  if (!read.ok) return failed(read);
  const snapshot = read.value;
  if (snapshot.head.state !== "OPEN") return settleEnd(env, target, snapshot.head.state);

  const checks = summarizeChecks(snapshot.checks);
  const published = await publishChecks(env.ctx, threadId, target.pullRequest.number, checks);
  const fix = await autoFix(env, target, snapshot);
  if (fix.kind === "failed") return failed(fix);
  return {
    kind: "polled",
    changed: published || fix.kind === "sent" || fix.kind === "gave-up",
    pending: checks?.state === "pending",
  };
};

// A thread being merged is left to the merge that is running; a paused or archived project runs nothing.
const loadTarget = async (env: WatchEnv, threadId: string): Promise<WatchTarget | null> => {
  const { ctx } = env;
  const thread = await ctx.threadRepository.getById(threadId);
  const pullRequest = thread && pullRequestOf(thread);
  if (!thread?.repoId || pullRequest?.state !== "open" || thread.status === "landing") return null;
  const [repo, project] = await Promise.all([
    ctx.repoRepository.getById(thread.repoId),
    ctx.projectRepository.getById(thread.projectId),
  ]);
  return repo && project?.status === "active" ? { thread, repo, project, pullRequest } : null;
};

// The report is written down in the transaction that stores it, before the thread is brought in
// line: a crash in between leaves a pull request the next poll finds ended again, whose report is
// already told. Merging goes through the landing the merge route uses, not a copy of it.
const settleEnd = async (
  env: WatchEnv,
  target: WatchTarget,
  state: "CLOSED" | "MERGED",
): Promise<PollResult> => {
  const kind = state === "MERGED" ? "merged" : "closed";
  await reportEnd(env, target, kind);
  const synced = await env.syncPullRequest(target.thread.id);
  if (!synced.success) {
    const message = `The thread was not brought in line with its ${kind} pull request: ${synced.error.code}`;
    return { kind: "failed", message, rateLimited: false };
  }
  // A sync that could not read the pull request, or found another open one on the branch, changes
  // nothing: this is a failure to back off from, not news to look at again in 30 seconds.
  if (pullRequestOf(synced.thread)?.state === "open") {
    const message = `GitHub says the pull request is ${kind}, but the thread still has it open`;
    return { kind: "failed", message, rateLimited: false };
  }
  logger.info("Pull request #{number} of thread {threadId} was {kind} on GitHub", {
    number: target.pullRequest.number,
    threadId: target.thread.id,
    kind,
  });
  return { kind: "polled", changed: true, pending: false };
};

// Only a pull request AOP still has open is a find of the watcher's: one a person just merged
// through AOP has been reported to whoever asked.
const reportEnd = async (
  env: WatchEnv,
  target: WatchTarget,
  kind: "merged" | "closed",
): Promise<void> => {
  const { thread, pullRequest } = target;
  const woken = await env.ctx.eventPublisher.transaction(async (tx) => {
    const repository = createWatchRepository(tx.db);
    if (hasKind(await repository.entries(thread.id), kind)) return [];
    const current = await createThreadRepository(tx.db).getById(thread.id);
    if (!current || current.status === "landing" || pullRequestOf(current)?.state !== "open") {
      return [];
    }
    const summary = `pull request #${pullRequest.number} ${kind}`;
    await repository.record(thread.id, newReport(kind, summary, env.now()));
    // The line that says the watcher gave up is over once the pull request is: it is the watcher's own.
    if (isCapStatusLine(current.liveStatusLine)) {
      const ended = kind === "merged" ? "was merged" : "was closed without merging";
      await createThreadRepository(tx.db).update(thread.id, {
        liveStatusLine: `Pull request #${pullRequest.number} ${ended}`,
      });
      await recordThreadUpserted(tx, thread.id);
    }
    return reportInTransaction(tx, target, kind);
  });
  await env.wake(woken);
};

const failed = ({
  message,
  rateLimited,
}: {
  message: string;
  rateLimited: boolean;
}): PollResult => ({ kind: "failed", message, rateLimited });
