import { pullRequestOf } from "../thread/state.ts";
import type { ThreadResult } from "../thread/types.ts";
import type { WatchEnv } from "./env.ts";
import { attemptsOf, hasKind, type WatchEntry } from "./ledger.ts";

/** What the watcher has done for one thread's pull request, for a person to read. */
export interface WatchSummary {
  /** Whether the project lets the watcher answer failing checks, requested changes and conflicts by itself. */
  enabled: boolean;
  maxAttempts: number;
  /** Fix prompts sent to the thread so far. */
  attempts: number;
  /** The watcher stopped at the cap and told the coordinator. */
  gaveUp: boolean;
  /** Everything it sent or reported, oldest first. */
  actions: { kind: WatchEntry["kind"]; summary: string; at: string }[];
}

export const summarizeWatch = async (
  env: WatchEnv,
  threadId: string,
): Promise<ThreadResult<{ watch: WatchSummary }>> => {
  const thread = await env.ctx.threadRepository.getById(threadId);
  if (!thread) return { success: false, error: { code: "THREAD_NOT_FOUND" } };
  if (!pullRequestOf(thread)) return { success: false, error: { code: "NO_PULL_REQUEST" } };
  const project = await env.ctx.projectRepository.getById(thread.projectId);
  const entries = (await env.repository.entries(threadId)).filter((entry) => entry.delivered);
  return {
    success: true,
    watch: {
      enabled: project?.autoFixPullRequests ?? false,
      maxAttempts: env.maxAttempts,
      attempts: attemptsOf(entries),
      gaveUp: hasKind(entries, "cap"),
      actions: entries.map(({ kind, summary, at }) => ({ kind, summary, at })),
    },
  };
};
