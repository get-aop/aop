import type { Dispatch, SetStateAction } from "react";
import { type ChatSessionDetail, commitSessionGit } from "../../api/client";

export const createSessionCommitHandler = (
  session: ChatSessionDetail,
  showToast: (message: string) => void,
  refreshGitStatus: Dispatch<SetStateAction<number>>,
): ((mode: "commit" | "commit-and-push") => Promise<void>) | undefined => {
  if (!session.workspacePath || session.workspacePath === session.repoPath) return undefined;
  return async (mode) => {
    try {
      const result = await commitSessionGit(session.id, { push: mode === "commit-and-push" });
      showToast(
        result.pushed
          ? `Committed and pushed ${result.branch}`
          : `Committed changes on ${result.branch}`,
      );
      refreshGitStatus((token) => token + 1);
    } catch (error) {
      showToast(commitErrorMessage(error));
    }
  };
};

const commitErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "code" in error && error.code === "NO_CHANGES") {
    return "Nothing to commit";
  }
  return error instanceof Error ? error.message : "Could not commit changes";
};
