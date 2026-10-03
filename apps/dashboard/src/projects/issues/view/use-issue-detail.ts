import type { IssueDetail } from "@aop/common";
import { useCallback, useEffect, useState } from "react";
import { getIssueDetail } from "../../../api/issues";
import { ApiError } from "../../../api/request";

export interface IssueDetailState {
  detail: IssueDetail | null;
  loading: boolean;
  /** Why the issue could not be read, and the host's code for it (`JIRA_UNAUTHORIZED`, ...). */
  error: { message: string; code: string | null } | null;
  reload: () => void;
}

/**
 * One issue read whole through the host, fresh each time the view opens it: the list holds no
 * descriptions or comments, and the view should show what the issue says now.
 */
export const useIssueDetail = (projectId: string, key: string): IssueDetailState => {
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<IssueDetailState["error"]>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void attempt;
    let current = true;
    setLoading(true);
    setError(null);
    getIssueDetail(projectId, key).then(
      (read) => {
        if (!current) return;
        setDetail(read);
        setLoading(false);
      },
      (cause: unknown) => {
        if (!current) return;
        setDetail(null);
        setError({
          message: cause instanceof Error ? cause.message : String(cause),
          code: cause instanceof ApiError ? cause.code : null,
        });
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, key, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { detail, loading, error, reload };
};
