import { QUEUED_UPDATE_MAX_WAIT_MS, type QueuedUpdate, type RunningTurn } from "@aop/common";

/** A turn the host is running, with the run it belongs to so a queued update can follow it. */
export interface RunningTurnRef extends RunningTurn {
  runId: string;
}

interface Queued {
  since: number;
  version: string;
  by: QueuedUpdate["by"];
  /** The runs that were going when it was queued: it waits for these, not for later ones. */
  runIds: ReadonlySet<string>;
}

/**
 * "Update when they finish". The host installs at the first moment none of the turns that were
 * running when it was asked is still running: at once if every turn ends, and also on a host that
 * is never idle, since turns started after it was queued are not waited for (they keep running
 * through the restart; their chats pause for its few seconds). It never forces the restart: once
 * it has waited `QUEUED_UPDATE_MAX_WAIT_MS` it shows as expired, for a person to update now or
 * cancel, and still installs if those turns end first.
 */
export interface UpdateQueue {
  queue: (version: string, by: QueuedUpdate["by"], running: readonly RunningTurnRef[]) => void;
  cancel: () => void;
  /** What clients see of the queued update, or null when none is. */
  view: (running: readonly RunningTurnRef[]) => QueuedUpdate | null;
  /** The release a queued update installs, once it may start now; null while it waits. */
  due: (running: readonly RunningTurnRef[]) => string | null;
  queuedBy: () => QueuedUpdate["by"] | null;
}

export const createUpdateQueue = (now: () => number): UpdateQueue => {
  let queued: Queued | null = null;

  const waitingFor = (running: readonly RunningTurnRef[]): number =>
    queued ? running.filter((turn) => queued?.runIds.has(turn.runId)).length : 0;

  return {
    queue: (version, by, running) => {
      queued = { since: now(), version, by, runIds: new Set(running.map((turn) => turn.runId)) };
    },
    cancel: () => {
      queued = null;
    },
    view: (running) =>
      queued && {
        since: new Date(queued.since).toISOString(),
        version: queued.version,
        waitingFor: waitingFor(running),
        by: queued.by,
        expired: now() - queued.since >= QUEUED_UPDATE_MAX_WAIT_MS,
      },
    due: (running) => (queued && waitingFor(running) === 0 ? queued.version : null),
    queuedBy: () => queued?.by ?? null,
  };
};
