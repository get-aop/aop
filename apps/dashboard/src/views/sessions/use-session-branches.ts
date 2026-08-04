import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback } from "react";
import type { ChatSessionDetail, ChatSessionSummary } from "../../api/client";
import { listSessionGitBranches, switchSessionGitBranch } from "../../api/client";

interface SessionBranchesInput {
  activeIdRef: MutableRefObject<string | null>;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setWorkspaceRefreshToken: Dispatch<SetStateAction<number>>;
  reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null>;
  refreshList: () => Promise<ChatSessionSummary[]>;
  showToast: (message: string) => void;
}

/** Active-session branch list/switch actions. */
export const useSessionBranches = (input: SessionBranchesInput) => {
  const listActiveSessionBranches = useCallback(() => {
    const sessionId = input.activeIdRef.current;
    if (!sessionId) return Promise.reject(new Error("No active session"));
    return listSessionGitBranches(sessionId);
  }, [input.activeIdRef]);

  const switchActiveSessionBranch = useCallback(
    async (branch: string) => {
      const sessionId = input.activeIdRef.current;
      if (!sessionId) throw new Error("No active session");
      const result = await switchSessionGitBranch(sessionId, branch);
      input.setDetail((current) =>
        current?.id === sessionId
          ? { ...current, branch: result.branch, workspacePath: result.workspacePath }
          : current,
      );
      input.setWorkspaceRefreshToken((value) => value + 1);
      await Promise.all([input.reloadDetailQuiet(sessionId), input.refreshList()]);
      input.showToast(`Switched to ${result.branch}`);
    },
    [input],
  );

  return { listActiveSessionBranches, switchActiveSessionBranch };
};
