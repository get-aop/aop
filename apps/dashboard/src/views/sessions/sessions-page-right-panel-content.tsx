import type { ChatSessionDetail } from "../../api/client";
import { ChecksPane } from "../../workspace/right-panel";
import { SessionDiffPanel } from "./SessionDiffPanel";
import type { SessionToastLink } from "./SessionModals";

export const RightPanelTabContent = ({
  tab,
  active,
  onCloseDiff,
  showToast,
  diffRefreshKey,
  pullRequest,
}: {
  tab: import("../../workspace/right-panel").RightPanelTab;
  active: ChatSessionDetail | null;
  onCloseDiff: () => void;
  showToast: (message: string, link?: SessionToastLink) => void;
  diffRefreshKey: number;
  pullRequest: import("./use-session-pull-request").SessionPullRequestController | null;
}) => {
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
      embedded
    />
  );
};
