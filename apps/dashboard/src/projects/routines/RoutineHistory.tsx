import type { RoutineRun } from "@aop/common";
import { ArrowUpRightIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/ui/badge";
import { listRoutineRuns } from "../../api/routines";
import { Link, projectPath, threadPath } from "../../shell/router";
import {
  formatRunTime,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  RUN_TRIGGER_LABEL,
} from "./routine-format";

/**
 * One routine's runs, newest first: when, how it went and why, and the thread or chat message
 * it made. `version` changes whenever the routine does, so a run that just began or ended shows.
 */
export const RoutineHistory = ({
  projectId,
  routineId,
  timeZone,
  version,
}: {
  projectId: string;
  routineId: string;
  timeZone: string | null;
  version: string;
}) => {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await listRoutineRuns(projectId, routineId));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [projectId, routineId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the reason to read again.
  useEffect(() => {
    void load();
  }, [load, version]);

  if (error) {
    return <p className="px-3 pb-3 text-meta text-blocked">Could not load the history: {error}</p>;
  }
  if (runs === null) return <p className="px-3 pb-3 text-meta text-text-subtle">Loading…</p>;
  if (runs.length === 0) {
    return (
      <p data-testid="routine-history-empty" className="px-3 pb-3 text-meta text-text-subtle">
        No runs yet.
      </p>
    );
  }
  return (
    <ol data-testid="routine-history" className="flex flex-col border-t border-border">
      {runs.map((run) => (
        <li
          key={run.id}
          data-testid="routine-run"
          data-status={run.status}
          className="flex min-w-0 flex-col gap-0.5 border-b border-border px-3 py-2 last:border-b-0"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
            <span className="text-meta text-text-muted tabular-nums">
              {formatRunTime(run.occurrence, timeZone)}
            </span>
            <span className="text-meta text-text-subtle">{RUN_TRIGGER_LABEL[run.trigger]}</span>
            <span className="flex-1" />
            <RunLink projectId={projectId} run={run} />
          </div>
          {run.reason ? <p className="text-meta text-text-subtle">{run.reason}</p> : null}
        </li>
      ))}
    </ol>
  );
};

const RunLink = ({ projectId, run }: { projectId: string; run: RoutineRun }) => {
  if (run.threadId) {
    return (
      <Link
        to={threadPath(projectId, run.threadId)}
        data-testid="routine-run-thread"
        className="inline-flex items-center gap-1 text-meta text-running hover:underline"
      >
        Open thread
        <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
      </Link>
    );
  }
  if (run.messageId) {
    return (
      <Link
        to={projectPath(projectId)}
        data-testid="routine-run-message"
        className="inline-flex items-center gap-1 text-meta text-running hover:underline"
      >
        In the chat
        <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
      </Link>
    );
  }
  return null;
};
