import type { PullRequestMergeMethod, PullRequestViewDetail } from "@aop/common";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  commentOnPullRequest,
  mergePullRequest,
  type PullRequestKey,
  reviewPullRequest,
  updatePullRequest,
} from "../../api/pull-request-view";
import { requestConfirmation } from "../../components/ConfirmationHost";

export type PullRequestAction =
  | "comment"
  | "approve"
  | "request-changes"
  | "merge"
  | "rename"
  | "close"
  | "reopen"
  | "draft"
  | "ready";

export interface PullRequestActions {
  /** The host owner with write access: the page shows its buttons. */
  canWrite: boolean;
  /** The action on its way to GitHub, so its button can say so and the others wait. */
  pending: PullRequestAction | null;
  comment: (body: string) => Promise<boolean>;
  review: (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string) => Promise<boolean>;
  merge: (method: PullRequestMergeMethod) => Promise<boolean>;
  rename: (title: string) => Promise<boolean>;
  setOpen: (open: boolean) => Promise<boolean>;
  setDraft: (draft: boolean) => Promise<boolean>;
}

const REVIEW_ACTION = {
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
  COMMENT: "comment",
} as const;

const DONE: Record<PullRequestAction, string> = {
  comment: "Comment posted",
  approve: "Approved",
  "request-changes": "Changes requested",
  merge: "Pull request merged",
  rename: "Title updated",
  close: "Pull request closed",
  reopen: "Pull request reopened",
  draft: "Converted to draft",
  ready: "Marked ready for review",
};

/**
 * What the host owner can do to the pull request. Each action is one host call, then the page is
 * read again; GitHub's refusal (a ruleset, a moved head) is shown as GitHub worded it. Merging and
 * closing ask first.
 */
export const usePullRequestActions = (
  key: PullRequestKey,
  detail: PullRequestViewDetail | null,
  act: (write: () => Promise<unknown>) => Promise<Error | null>,
): PullRequestActions => {
  const [pending, setPending] = useState<PullRequestAction | null>(null);
  const { projectId, repoId, number } = key;

  const run = useCallback(
    async (action: PullRequestAction, write: () => Promise<unknown>): Promise<boolean> => {
      setPending(action);
      try {
        const failure = await act(write);
        if (failure) toast.error(failure.message);
        else toast.success(DONE[action]);
        return failure === null;
      } finally {
        setPending(null);
      }
    },
    [act],
  );

  const target = { projectId, repoId, number };
  const headSha = detail?.headSha ?? "";
  const title = detail?.title ?? "";

  return {
    canWrite: detail?.viewer.canWrite === true,
    pending,
    comment: (body) => run("comment", () => commentOnPullRequest(target, { body })),
    review: (event, body) =>
      run(REVIEW_ACTION[event], () => reviewPullRequest(target, { event, body })),
    merge: async (method) => {
      const confirmed = await requestConfirmation({
        title: `Merge pull request #${number}?`,
        message: `${MERGE_WORDS[method]} into ${detail?.baseRefName ?? "the base branch"} on GitHub: “${title}”.`,
        confirmLabel: MERGE_LABEL[method],
      });
      if (!confirmed) return false;
      return run("merge", () => mergePullRequest(target, { method, expectedHeadSha: headSha }));
    },
    rename: (next) => run("rename", () => updatePullRequest(target, { title: next })),
    setOpen: async (open) => {
      if (!open) {
        const confirmed = await requestConfirmation({
          title: `Close pull request #${number}?`,
          message: "It stays on GitHub and can be reopened.",
          confirmLabel: "Close pull request",
          destructive: true,
        });
        if (!confirmed) return false;
      }
      return run(open ? "reopen" : "close", () =>
        updatePullRequest(target, { state: open ? "open" : "closed" }),
      );
    },
    setDraft: (draft) => run(draft ? "draft" : "ready", () => updatePullRequest(target, { draft })),
  };
};

export const MERGE_LABEL: Record<PullRequestMergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

const MERGE_WORDS: Record<PullRequestMergeMethod, string> = {
  squash: "Its commits are squashed into one commit",
  merge: "All its commits are added with a merge commit",
  rebase: "Its commits are rebased and added",
};
