import type { ProjectIssue } from "@aop/common";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { startThreadFromIssue } from "../../api/issues";

export interface StartThread {
  start: (issue: ProjectIssue) => Promise<void>;
  /** The keys of issues whose request is on its way. */
  pending: ReadonlySet<string>;
}

/**
 * Asks the coordinator to start a thread for an issue. The host sends the coordinator the
 * issue's title, body and link, and the request shows in the coordinator chat like a message
 * the person typed; a toast says it went (or why not).
 */
export const useStartThread = (projectId: string): StartThread => {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const start = useCallback(
    async (issue: ProjectIssue) => {
      setPending((current) => new Set(current).add(issue.key));
      try {
        await startThreadFromIssue(projectId, issue.key);
        toast.success(`Asked the coordinator to start a thread for ${issue.identifier}`, {
          description: "Its request is in the coordinator chat.",
        });
      } catch (cause) {
        toast.error(`Could not start a thread for ${issue.identifier}`, {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(issue.key);
          return next;
        });
      }
    },
    [projectId],
  );

  return { start, pending };
};
