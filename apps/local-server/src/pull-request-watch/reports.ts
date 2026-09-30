import type { Project, ThreadReportOutcome } from "@aop/common";
import type { PublisherTransaction } from "../event-log/publisher.ts";
import { postThreadReport } from "../thread/turn-outcome.ts";
import type { WatchTarget } from "./env.ts";
import type { ReportKind } from "./ledger.ts";

const CAP_LINE = "Auto-fix stopped after";
const CAP_LINE_SUMMARY_MAX = 300;

/** The line under a thread's title once the watcher has given up on its pull request. */
export const capStatusLine = (tries: string, summary: string): string =>
  `${CAP_LINE} ${tries}: ${summary.slice(0, CAP_LINE_SUMMARY_MAX)}`;

/** Whether a thread's line is the one the watcher wrote when it gave up, and so is the watcher's to replace. */
export const isCapStatusLine = (line: string | null): boolean =>
  line?.startsWith(CAP_LINE) ?? false;

/**
 * Tells the project's coordinator how a thread's pull request ended or that the watcher gave up,
 * in the transaction the caller is in, the way a thread's own report reaches it. Returns the
 * coordinator to wake once it commits. What reaches the person is up to the client and the
 * project's notification level: the desktop app turns a coordinator post, and a pull request
 * that merged or closed, into notifications, and stays silent when the level is `off`.
 */
export const reportInTransaction = async (
  tx: PublisherTransaction,
  { thread, project, pullRequest }: WatchTarget,
  kind: ReportKind,
  detail = "",
): Promise<string[]> => {
  const { outcome, text } = describeReport(thread, project, pullRequest.number, kind, detail);
  return postThreadReport(tx, thread, outcome, text);
};

const describeReport = (
  thread: { id: string; title: string },
  project: Pick<Project, "name">,
  number: number,
  kind: ReportKind,
  detail: string,
): { outcome: ThreadReportOutcome; text: string } => {
  const subject = `Thread report: "${thread.title}" (${thread.id})`;
  switch (kind) {
    case "merged":
      return {
        outcome: "finished",
        text: `${subject}: its pull request #${number} was merged on GitHub.`,
      };
    case "closed":
      return {
        outcome: "needs-you",
        text: `${subject}: its pull request #${number} was closed without being merged, so the thread has nothing left to land. Ask the person whether the work should go on in a new thread.`,
      };
    case "cap":
      return {
        outcome: "needs-you",
        text: `${subject}: AOP stopped fixing pull request #${number} by itself in project "${project.name}" after ${detail}. Steer the thread yourself, or ask the person to look at it.`,
      };
  }
};
