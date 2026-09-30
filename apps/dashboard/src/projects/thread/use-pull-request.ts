import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "../../api/request";
import {
  type MergeMethod,
  mergeThreadPullRequest,
  openThreadPullRequest,
  syncThreadPullRequest,
} from "../../api/threads";

export type PullRequestOp = "open" | "merge" | "sync";

/** What the host refused, as it said it: its code and its own sentence, kept until the next attempt. */
export interface PullRequestProblem {
  op: PullRequestOp;
  code: string;
  message: string;
}

export interface PullRequestControls {
  /** The call in flight; every control is disabled meanwhile, since the host runs them one at a time. */
  busy: PullRequestOp | null;
  problem: PullRequestProblem | null;
  /** Commits and pushes the branch and opens the pull request; with one open already, only pushes. */
  open: (options?: { draft?: boolean }) => Promise<void>;
  merge: (method: MergeMethod) => Promise<void>;
  sync: () => Promise<void>;
  dismiss: () => void;
}

/**
 * The thread's pull request calls. None sets the thread's state: the host publishes the thread
 * as it changes, and the page follows. A refusal is shown as the host words it, with its code,
 * so the person can tell "push what the thread did since" from "wait for the turn to end".
 */
export const usePullRequestControls = (threadId: string): PullRequestControls => {
  const [busy, setBusy] = useState<PullRequestOp | null>(null);
  const [problem, setProblem] = useState<PullRequestProblem | null>(null);

  const run = useCallback(async (op: PullRequestOp, call: () => Promise<string>) => {
    setBusy(op);
    setProblem(null);
    try {
      toast.success(await call());
    } catch (error) {
      setProblem({
        op,
        code: error instanceof ApiError ? error.code : "UNKNOWN",
        message: error instanceof Error ? error.message : "Could not reach the host",
      });
    } finally {
      setBusy(null);
    }
  }, []);

  return {
    busy,
    problem,
    open: (options = {}) =>
      run("open", async () => {
        const { pullRequest, created } = await openThreadPullRequest(threadId, options);
        return created
          ? `Opened pull request #${pullRequest.number}`
          : `Pushed the latest changes to #${pullRequest.number}`;
      }),
    merge: (method) =>
      run("merge", async () => {
        await mergeThreadPullRequest(threadId, method);
        return "Merged the pull request";
      }),
    sync: () =>
      run("sync", async () => {
        await syncThreadPullRequest(threadId);
        return "In step with GitHub";
      }),
    dismiss: () => setProblem(null),
  };
};
