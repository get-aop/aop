import type { TerminalLine } from "@aop/common";

import type { ChatSessionDetail } from "../../api/client";
import { ChecksPane, LogPane } from "../../workspace/right-panel";
import { TasksPane } from "../../workspace/tasks-pane";
import { SessionDiffPanel } from "./SessionDiffPanel";
import type { SessionToastLink } from "./SessionModals";

export const RightPanelTabContent = ({
  tab,
  active,
  onCloseDiff,
  showToast,
  diffRefreshKey,
  pullRequest,
  termLines,
}: {
  tab: import("../../workspace/right-panel").RightPanelTab;
  active: ChatSessionDetail | null;
  onCloseDiff: () => void;
  showToast: (message: string, link?: SessionToastLink) => void;
  diffRefreshKey: number;
  pullRequest: import("./use-session-pull-request").SessionPullRequestController | null;
  termLines: TerminalLine[];
}) => {
  if (tab === "tasks") return <TasksPane />;
  if (tab === "log") return <LogPane lines={termLines} />;
  if (tab === "checks") {
    return (
      <ChecksPane
        checks={(pullRequest?.status?.checks ?? []).map((check) => ({
          workflow: check.workflow,
          name: check.name,
          state: check.state as "success" | "failure" | "pending" | "skipped",
          startedAt: check.startedAt,
          completedAt: check.completedAt,
        }))}
        prTitle={pullRequest?.status?.pr?.title ?? null}
      />
    );
  }
  if (!active) return null;
  return (
    <SessionDiffPanel
      sessionId={active.id}
      onClose={onCloseDiff}
      showToast={showToast}
      refreshKey={diffRefreshKey}
    />
  );
};

/** The resizable workspace: center ⇄ right panel, then the terminal dock. */
