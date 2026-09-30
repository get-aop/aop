import type { Thread } from "@aop/common";
import type { ReactNode } from "react";
import { pullRequestOf } from "../selectors";
import { hasPullRequestBar, PullRequestBar, PullRequestProblemNotice } from "./PullRequestBar";
import { usePullRequestBarHidden } from "./pr-bar-hidden";
import { usePullRequestControls } from "./use-pull-request";

/**
 * The pull request bar and what the host refused, ready to sit above the box that steers the
 * thread. `dock` is null for a thread with no repository, one with nothing for the bar, and
 * while the person has sent the bar away; `bringBack` is given only then. A pull request that
 * exists is merged from the bar, so it is never put away.
 */
export const usePullRequestDock = ({
  thread,
  changedFiles,
  changesOpen,
  onToggleChanges,
}: {
  thread: Thread;
  changedFiles: number;
  changesOpen: boolean;
  onToggleChanges: () => void;
}): { dock: ReactNode; bringBack: (() => void) | undefined } => {
  const controls = usePullRequestControls(thread.id);
  const [hidden, setHidden] = usePullRequestBarHidden(thread.id);
  const awayable = pullRequestOf(thread) === null;
  const eligible = thread.repoId !== null && hasPullRequestBar(thread, changedFiles);
  const away = eligible && awayable && hidden;

  const dock =
    eligible && !away ? (
      <>
        <PullRequestProblemNotice controls={controls} />
        <PullRequestBar
          thread={thread}
          controls={controls}
          changedFiles={changedFiles}
          changesOpen={changesOpen}
          onToggleChanges={onToggleChanges}
          onHide={() => setHidden(true)}
        />
      </>
    ) : null;
  return { dock, bringBack: away ? () => setHidden(false) : undefined };
};
