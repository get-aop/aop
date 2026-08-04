import { useEffect, useState } from "react";
import type { TaskPullRequestStatusResponse } from "../api/client";
import { getTaskPullRequestStatus } from "../api/client";
import type { Task } from "../types";

const PULL_REQUEST_STATUS_POLL_MS = 10_000;

type PullRequestAvailability = Pick<
  TaskPullRequestStatusResponse,
  "hasPullRequest" | "checksState" | "pullRequestState" | "pullRequestUrl" | "pullRequestNumber"
>;

const emptyAvailability: PullRequestAvailability = {
  hasPullRequest: false,
  checksState: null,
  pullRequestState: null,
  pullRequestUrl: null,
  pullRequestNumber: null,
};

const pullRequestCache = new Map<string, PullRequestAvailability>();

const cacheKey = (repoId: string, taskId: string): string => `${repoId}:${taskId}`;

const toAvailability = (status: TaskPullRequestStatusResponse): PullRequestAvailability => ({
  hasPullRequest: status.hasPullRequest,
  checksState: status.checksState,
  pullRequestState: status.pullRequestState,
  pullRequestUrl: status.pullRequestUrl,
  pullRequestNumber: status.pullRequestNumber,
});

export const clearTaskPullRequestCacheForTests = (): void => {
  pullRequestCache.clear();
};

export const useTaskPullRequestAvailability = (task: Pick<Task, "id" | "repoId" | "status">) => {
  const key = cacheKey(task.repoId, task.id);

  const [ready, setReady] = useState(() => pullRequestCache.has(key));
  const [availability, setAvailability] = useState(
    () => pullRequestCache.get(key) ?? emptyAvailability,
  );

  useEffect(() => {
    if (task.status !== "DONE") {
      setReady(true);
      setAvailability(emptyAvailability);
      return;
    }

    const cached = pullRequestCache.get(key);
    if (cached !== undefined) {
      setReady(true);
      setAvailability(cached);
    } else {
      setReady(false);
      setAvailability(emptyAvailability);
    }

    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const status = await getTaskPullRequestStatus(task.repoId, task.id);
        if (cancelled) return;
        const nextAvailability = toAvailability(status);
        pullRequestCache.set(key, nextAvailability);
        setAvailability(nextAvailability);
        setReady(true);
      } catch {
        if (cancelled) return;
        pullRequestCache.set(key, emptyAvailability);
        setAvailability(emptyAvailability);
        setReady(true);
      }
    };

    void refreshStatus();

    return () => {
      cancelled = true;
    };
  }, [key, task.id, task.repoId, task.status]);

  useEffect(() => {
    // Keep polling while checks can still change underneath us (settling CI or a later green run).
    const canStillChange =
      availability.pullRequestState === "OPEN" || availability.checksState === null;
    if (task.status !== "DONE" || !availability.hasPullRequest || !canStillChange) {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void getTaskPullRequestStatus(task.repoId, task.id)
        .then((status) => {
          if (cancelled) return;
          const nextAvailability = toAvailability(status);
          pullRequestCache.set(key, nextAvailability);
          setAvailability(nextAvailability);
          setReady(true);
        })
        .catch(() => undefined);
    }, PULL_REQUEST_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    availability.checksState,
    availability.hasPullRequest,
    availability.pullRequestState,
    key,
    task.id,
    task.repoId,
    task.status,
  ]);

  return { ready, ...availability };
};
