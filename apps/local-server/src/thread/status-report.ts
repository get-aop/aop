import type { Thread, ThreadStep, ThreadWait } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { recordThreadUpserted } from "../project/events.ts";
import { createThreadRepository, type ThreadPatch } from "./repository.ts";
import { postThreadReport } from "./turn-outcome.ts";

/** What a thread reports about itself with `aop_report_status`. */
export interface StatusReport {
  line?: string | null;
  steps?: ThreadStep[];
  /** Something outside AOP it waits on the person for while it keeps working; absent when it waits on nothing. */
  waitingOn?: { reason: string; link?: string | null };
}

/**
 * Stores a thread's report. A report replaces what the thread waits on: one without `waitingOn`
 * says the wait is over. A wait belongs to a running turn, so a thread that is not working keeps
 * none. When a working thread starts waiting on the person, or waits on something else, its
 * coordinator is told; it returns the coordinator to wake once the change commits, or null when
 * there is no such thread.
 */
export const storeStatusReport = async (
  ctx: LocalServerContext,
  threadId: string,
  report: StatusReport,
): Promise<string[] | null> =>
  ctx.eventPublisher.transaction(async (tx) => {
    const threads = createThreadRepository(tx.db);
    const thread = await threads.getById(threadId);
    if (!thread) return null;
    const working = thread.status === "working";
    const waitingOn = working ? nextWait(thread.waitingOn ?? null, report.waitingOn) : null;
    await threads.update(threadId, { ...reportPatch(report), ...(working && { waitingOn }) });
    await recordThreadUpserted(tx, threadId);
    if (!waitingOn || waitingOn === thread.waitingOn) return [];
    return postThreadReport(tx, thread, "needs-you", waitReport(thread, waitingOn));
  });

const reportPatch = (report: StatusReport): ThreadPatch => ({
  ...(report.steps && { steps: report.steps }),
  ...(report.line !== undefined && { liveStatusLine: report.line }),
  lastActivityAt: new Date().toISOString(),
});

// The same wait reported again keeps the time it started, and tells nobody again.
const nextWait = (
  current: ThreadWait | null,
  reported: StatusReport["waitingOn"],
): ThreadWait | null => {
  if (!reported) return null;
  const link = reported.link ?? null;
  if (current?.reason === reported.reason && current.link === link) return current;
  return { reason: reported.reason, link, since: new Date().toISOString() };
};

const waitReport = (thread: Thread, wait: ThreadWait): string =>
  [
    `Thread report: "${thread.title}" (${thread.id}) is waiting on the person for something outside AOP, and keeps working meanwhile: ${wait.reason}`,
    ...(wait.link ? [`Where: ${wait.link}`] : []),
    "Tell the person. The thread clears this itself when it reports again or its turn ends.",
  ].join("\n");
